import "dotenv/config";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import fs from "fs";
import { stmt } from "./db.js";

function ensureDir(p){ if(!fs.existsSync(p)) fs.mkdirSync(p, { recursive:true }); }
ensureDir("./uploads");

const app = express();
app.use(express.json({ limit: "8mb" }));

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";

const EULEN_BASE_URL = process.env.EULEN_BASE_URL || "https://depix.eulen.app/api";
const EULEN_API_TOKEN = process.env.EULEN_API_TOKEN;

const PLATFORM_DEPIX_ADDRESS = String(process.env.PLATFORM_DEPIX_ADDRESS || "").trim();
const DEFAULT_COMMISSION_BPS_ENV = Number(process.env.DEFAULT_COMMISSION_BPS || 250);
const ADMIN_EMAIL = String(process.env.ADMIN_EMAIL || "").trim().toLowerCase();

apapp.get("/", (req, res) => res.redirect("/index.html"));
  p.use(express.static(path.join(__dirname, "public")));

function signToken(user) {
  return jwt.sign({ sub: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: "7d" });
}

function auth(req, res, next) {
  const h = String(req.headers.authorization || "");
  const token = h.startsWith("Bearer ") ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Não autenticado." });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.userId = payload.sub;
    req.role = payload.role;
    return next();
  } catch {
    return res.status(401).json({ error: "Token inválido." });
  }
}

function requireAdmin(req, res, next){
  if(req.role !== "admin") return res.status(403).json({ error: "Acesso negado." });
  next();
}

function normalizeMoneyToCents(brl) {
  const s = String(brl ?? "").trim().replace(/\./g, "").replace(",", ".");
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100);
}

function isProbablyDePixAddress(addr) {
  const s = String(addr || "").trim();
  return s.length >= 20 && /^[a-z0-9]+$/i.test(s);
}

function getDefaultCommissionBps(){
  const row = stmt.getSetting.get("defaultCommissionBps");
  const n = Number(row?.value ?? DEFAULT_COMMISSION_BPS_ENV);
  return Number.isFinite(n) ? Math.max(0, Math.min(5000, n)) : 250;
}

function computeFee(amountInCents, commissionBps){
  const fee = Math.floor((amountInCents * commissionBps) / 10000);
  const net = Math.max(0, amountInCents - fee);
  return { feeInCents: fee, netInCents: net };
}

app.post("/api/auth/register", async (req, res) => {
  const { email, password, fullName, taxNumber } = req.body || {};
  const e = String(email || "").trim().toLowerCase();
  const p = String(password || "");

  if (!e.includes("@")) return res.status(400).json({ error: "Email inválido." });
  if (p.length < 8) return res.status(400).json({ error: "Senha deve ter 8+ caracteres." });

  const exists = stmt.getUserByEmail.get(e);
  if (exists) return res.status(409).json({ error: "Email já cadastrado." });

  const passwordHash = await bcrypt.hash(p, 12);
  const now = new Date().toISOString();
  const role = (ADMIN_EMAIL && e === ADMIN_EMAIL) ? "admin" : "user";

  stmt.createUser.run({
    email: e,
    passwordHash,
    role,
    fullName: fullName ? String(fullName).trim() : null,
    taxNumber: taxNumber ? String(taxNumber).replace(/\D/g, "") : null,
    createdAt: now
  });

  const user = stmt.getUserByEmail.get(e);
  res.json({ token: signToken(user) });
});

app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body || {};
  const e = String(email || "").trim().toLowerCase();
  const p = String(password || "");

  const user = stmt.getUserByEmail.get(e);
  if (!user) return res.status(401).json({ error: "Credenciais inválidas." });

  const ok = await bcrypt.compare(p, user.passwordHash);
  if (!ok) return res.status(401).json({ error: "Credenciais inválidas." });

  res.json({ token: signToken(user) });
});

app.get("/api/me", auth, (req, res) => {
  const user = stmt.getUserById.get(req.userId);
  if (!user) return res.status(404).json({ error: "Usuário não encontrado." });

  const defaultCommissionBps = getDefaultCommissionBps();
  const effectiveCommissionBps = (user.commissionBps ?? defaultCommissionBps);

  res.json({
    id: user.id,
    email: user.email,
    role: user.role,
    depixAddress: user.depixAddress,
    commissionBps: effectiveCommissionBps,
    createdAt: user.createdAt
  });
});

app.put("/api/me/wallet", auth, (req, res) => {
  const addr = String(req.body?.depixAddress || "").trim();
  if (!isProbablyDePixAddress(addr)) return res.status(400).json({ error: "Endereço DePix inválido." });
  stmt.updateUserWallet.run({ id: req.userId, depixAddress: addr });
  res.json({ ok: true });
});

app.post("/api/deposits", auth, async (req, res) => {
  try {
    if(!PLATFORM_DEPIX_ADDRESS) return res.status(500).json({ error: "PLATFORM_DEPIX_ADDRESS não configurado." });
    if(!EULEN_API_TOKEN) return res.status(500).json({ error: "EULEN_API_TOKEN não configurado." });

    const amountInCents = normalizeMoneyToCents(req.body?.amountBrl);
    if (!amountInCents) return res.status(400).json({ error: "Valor inválido." });

    const user = stmt.getUserById.get(req.userId);
    if (!user) return res.status(404).json({ error: "Usuário não encontrado." });
    if (!user.depixAddress) return res.status(400).json({ error: "Cadastre sua carteira DePix primeiro." });

    const commissionBps = (user.commissionBps ?? getDefaultCommissionBps());
    const { feeInCents, netInCents } = computeFee(amountInCents, commissionBps);

    const payload = { amountInCents, depixAddress: PLATFORM_DEPIX_ADDRESS };

    const r = await fetch(`${EULEN_BASE_URL}/deposit`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${EULEN_API_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const data = await r.json().catch(() => null);
    if (!r.ok) return res.status(502).json({ error: "Falha ao criar PIX.", upstream: data, upstreamStatus: r.status });

    const dep = data?.response;
    if (!dep?.id) return res.status(502).json({ error: "Resposta inesperada do provedor.", upstream: data });

    const now = new Date().toISOString();
    stmt.insertDeposit.run({
      id: dep.id,
      userId: req.userId,
      amountInCents,
      commissionBps,
      feeInCents,
      netInCents,
      platformDepixAddress: PLATFORM_DEPIX_ADDRESS,
      userDepixAddress: user.depixAddress,
      qrCopyPaste: dep.qrCopyPaste ?? null,
      qrImageUrl: dep.qrImageUrl ?? null,
      status: "created",
      payoutStatus: "not_sent",
      createdAt: now,
      updatedAt: now
    });

    res.json({
      id: dep.id,
      amountInCents,
      commissionBps,
      feeInCents,
      netInCents,
      qrCopyPaste: dep.qrCopyPaste,
      qrImageUrl: dep.qrImageUrl,
      status: "created",
      payoutStatus: "not_sent"
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erro interno." });
  }
});

app.get("/api/deposits", auth, (req, res) => {
  res.json(stmt.listDepositsByUser.all(req.userId));
});

app.get("/api/deposits/:id", auth, async (req, res) => {
  const id = String(req.params.id || "").trim();
  const row = stmt.getDeposit.get(id);
  if (!row || row.userId !== req.userId) return res.status(404).json({ error: "Não encontrado." });

  try {
    if(EULEN_API_TOKEN){
      const r = await fetch(`${EULEN_BASE_URL}/deposit-status?id=${encodeURIComponent(id)}`, {
        headers: { "Authorization": `Bearer ${EULEN_API_TOKEN}` }
      });
      if (r.ok) {
        const data = await r.json().catch(() => null);
        const st = data?.response;
        if (st?.status) {
          stmt.updateDeposit.run({
            id,
            status: st.status,
            bankTxId: st.bankTxId ?? null,
            blockchainTxID: st.blockchainTxID ?? null,
            expiration: st.expiration ?? null,
            payerName: st.payerName ?? null,
            payerTaxNumber: st.payerTaxNumber ?? null,
            updatedAt: new Date().toISOString()
          });
        }
      }
    }
  } catch {}

  res.json(stmt.getDeposit.get(id));
});

// Withdrawals (manual P2P)
app.post("/api/withdrawals", auth, (req, res) => {
  if(!PLATFORM_DEPIX_ADDRESS) return res.status(500).json({ error: "PLATFORM_DEPIX_ADDRESS não configurado." });

  const user = stmt.getUserById.get(req.userId);
  if(!user) return res.status(404).json({ error: "Usuário não encontrado." });
  if(!user.depixAddress) return res.status(400).json({ error: "Cadastre sua carteira DePix primeiro." });

  const amountDepix = String(req.body?.amountDepix || "").trim();
  const pixDestination = String(req.body?.pixDestination || "").trim();
  if(!amountDepix) return res.status(400).json({ error: "Informe o valor em DePix." });
  if(!pixDestination) return res.status(400).json({ error: "Informe o PIX de destino." });

  const now = new Date().toISOString();
  stmt.createWithdrawal.run({
    userId: req.userId,
    amountDepix,
    pixDestination,
    userDepixAddress: user.depixAddress,
    platformDepixAddress: PLATFORM_DEPIX_ADDRESS,
    status: "awaiting_transfer",
    createdAt: now,
    updatedAt: now
  });

  res.json({ ok:true, platformDepixAddress: PLATFORM_DEPIX_ADDRESS });
});

app.get("/api/withdrawals", auth, (req, res) => {
  res.json(stmt.listWithdrawalsByUser.all(req.userId));
});

app.post("/api/withdrawals/:id/proof", auth, (req, res) => {
  const id = Number(req.params.id);
  const row = stmt.getWithdrawalById.get(id);
  if(!row || row.userId !== req.userId) return res.status(404).json({ error: "Não encontrado." });

  const txid = String(req.body?.txid || "").trim();
  const fileBase64 = String(req.body?.fileBase64 || "");
  if(!txid) return res.status(400).json({ error: "Informe o TXID." });
  if(!fileBase64.startsWith("data:")) return res.status(400).json({ error: "Envie o comprovante em base64 (dataURL)." });

  const [meta, b64] = fileBase64.split(",", 2);
  const ext = (meta.includes("image/png") ? "png" :
               meta.includes("image/jpeg") ? "jpg" :
               meta.includes("application/pdf") ? "pdf" : "bin");

  const safeName = `withdrawal_${id}_${Date.now()}.${ext}`;
  const safePath = path.join(__dirname, "uploads", safeName);
  fs.writeFileSync(safePath, Buffer.from(b64, "base64"));

  stmt.updateWithdrawalProof.run({
    id,
    txid,
    receiptPath: `uploads/${safeName}`,
    status: "under_review",
    updatedAt: new Date().toISOString()
  });

  res.json({ ok:true });
});

// Admin
app.get("/api/admin/users", auth, requireAdmin, (req, res) => {
  res.json(stmt.adminListUsers.all());
});

app.put("/api/admin/settings/default-commission", auth, requireAdmin, (req, res) => {
  const bps = Number(req.body?.commissionBps);
  if(!Number.isFinite(bps) || bps < 0 || bps > 5000) return res.status(400).json({ error: "commissionBps inválido (0..5000)." });
  stmt.setSetting.run("defaultCommissionBps", String(Math.round(bps)));
  res.json({ ok:true });
});

app.put("/api/admin/users/:id/commission", auth, requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const bpsRaw = req.body?.commissionBps;

  if(bpsRaw === null){
    stmt.updateUserCommission.run({ id, commissionBps: null });
    return res.json({ ok:true });
  }

  const bps = Number(bpsRaw);
  if(!Number.isFinite(bps) || bps < 0 || bps > 5000) return res.status(400).json({ error: "commissionBps inválido (0..5000)." });
  stmt.updateUserCommission.run({ id, commissionBps: Math.round(bps) });
  res.json({ ok:true });
});

app.get("/api/admin/withdrawals", auth, requireAdmin, (req, res) => {
  res.json(stmt.adminListWithdrawals.all());
});

app.put("/api/admin/withdrawals/:id/status", auth, requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const status = String(req.body?.status || "").trim();
  const adminNote = String(req.body?.adminNote || "").trim();

  const allowed = new Set(["under_review","approved","paid","rejected","awaiting_transfer"]);
  if(!allowed.has(status)) return res.status(400).json({ error: "Status inválido." });

  stmt.adminUpdateWithdrawalStatus.run({ id, status, adminNote: adminNote || null, updatedAt: new Date().toISOString() });
  res.json({ ok:true });
});

app.get("/uploads/:file", auth, requireAdmin, (req, res) => {
  const f = req.params.file.replace(/[^\w.\-]/g, "");
  const p = path.join(__dirname, "uploads", f);
  if(!fs.existsSync(p)) return res.status(404).send("not found");
  res.sendFile(p);
});

app.listen(PORT, () => console.log(`✅ http://localhost:${PORT}`));
