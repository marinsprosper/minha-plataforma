import { getToken, logout } from "./auth.js";

const token = getToken();
if(!token) location.href="/login.html";

const $ = (s)=>document.querySelector(s);
const headers = { "Authorization": `Bearer ${token}", "Content-Type":"application/json" };

$("#logout").addEventListener("click", (e)=>{ e.preventDefault(); logout(); });

async function apiGet(url){
  const r = await fetch(url, { headers });
  const data = await r.json().catch(()=> ({}));
  if(!r.ok) throw new Error(data.error || "Erro");
  return data;
}
async function apiPut(url, body){
  const r = await fetch(url, { method:"PUT", headers, body: JSON.stringify(body) });
  const data = await r.json().catch(()=> ({}));
  if(!r.ok) throw new Error(data.error || "Erro");
  return data;
}

function pctToBps(pctStr){
  const s = String(pctStr||"").trim().replace(",", ".");
  const n = Number(s);
  if(!Number.isFinite(n)) return null;
  return Math.round(n * 100); // 2.50% -> 250 bps
}
function bpsToPct(bps){ return (Number(bps)/100).toFixed(2); }

async function loadUsers(){
  const rows = await apiGet("/api/admin/users");
  const tb = $("#usersTable tbody");
  tb.innerHTML = "";

  for(const u of rows){
    const current = (u.commissionBps === null || u.commissionBps === undefined) ? "" : bpsToPct(u.commissionBps);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${u.email}</td>
      <td>${u.depixAddress ? `<code>${u.depixAddress}</code>` : "<span class='muted'>—</span>"}</td>
      <td><input data-user="${u.id}" class="uPct" placeholder="(global)" value="${current}" style="min-width:120px"/></td>
      <td>
        <button class="btn ghost saveUser" data-user="${u.id}">Salvar</button>
        <button class="btn ghost clearUser" data-user="${u.id}">Limpar</button>
      </td>
    `;
    tb.appendChild(tr);
  }

  for(const b of document.querySelectorAll(".saveUser")){
    b.addEventListener("click", async ()=>{
      const id = Number(b.dataset.user);
      const inp = document.querySelector(`input.uPct[data-user="${id}"]`);
      const bps = pctToBps(inp.value);
      if(bps === null || bps < 0 || bps > 5000) return alert("Comissão inválida (0% a 50%).");
      await apiPut(`/api/admin/users/${id}/commission`, { commissionBps: bps });
      alert("Salvo ✔️");
    });
  }
  for(const b of document.querySelectorAll(".clearUser")){
    b.addEventListener("click", async ()=>{
      const id = Number(b.dataset.user);
      await apiPut(`/api/admin/users/${id}/commission`, { commissionBps: null });
      const inp = document.querySelector(`input.uPct[data-user="${id}"]`);
      inp.value = "";
      alert("Voltando pra global ✔️");
    });
  }
}

async function saveGlobal(){
  const msg = $("#globalMsg");
  msg.textContent = "Salvando...";
  try{
    const bps = pctToBps($("#globalPct").value);
    if(bps === null || bps < 0 || bps > 5000) throw new Error("Comissão inválida (0% a 50%).");
    await apiPut("/api/admin/settings/default-commission", { commissionBps: bps });
    msg.textContent = "Salvo ✔️";
  }catch(e){
    msg.textContent = e.message;
  }
}

async function loadWithdrawals(){
  const rows = await apiGet("/api/admin/withdrawals");
  const tb = $("#wdTable tbody");
  tb.innerHTML = "";

  for(const w of rows){
    const file = (w.receiptPath || "").split("/").pop();
    const link = file ? `<a class="link" href="/uploads/${file}" target="_blank">abrir</a>` : "<span class='muted'>—</span>";
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><code>${w.id}</code></td>
      <td>${w.userEmail}</td>
      <td>${w.amountDepix} DePix</td>
      <td>${w.pixDestination}</td>
      <td>${w.status}</td>
      <td>${w.txid ? `<code>${w.txid}</code>` : "<span class='muted'>—</span>"}</td>
      <td>${link}</td>
      <td><button class="btn ghost pickWd" data-id="${w.id}">Selecionar</button></td>
    `;
    tb.appendChild(tr);
  }

  for(const b of document.querySelectorAll(".pickWd")){
    b.addEventListener("click", ()=>{
      $("#wdId").value = b.dataset.id;
      $("#wdMsg").textContent = "Saque selecionado.";
    });
  }
}

async function updateWithdrawal(){
  const msg = $("#wdMsg");
  msg.textContent = "Atualizando...";
  try{
    const id = Number($("#wdId").value);
    if(!id) throw new Error("Informe o ID.");
    const status = $("#wdStatus").value;
    const adminNote = $("#wdNote").value.trim();
    await apiPut(`/api/admin/withdrawals/${id}/status`, { status, adminNote });
    msg.textContent = "Atualizado ✔️";
    await loadWithdrawals();
  }catch(e){
    msg.textContent = e.message;
  }
}

$("#saveGlobal").addEventListener("click", saveGlobal);
$("#updateWd").addEventListener("click", updateWithdrawal);

// init (garante admin)
const me = await apiGet("/api/me");
if(me.role !== "admin") location.href="/app.html";

await loadUsers();
await loadWithdrawals();
