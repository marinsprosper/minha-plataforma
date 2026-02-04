import { getToken, logout } from "./auth.js";

const token = getToken();
if(!token) location.href="/login.html";

const $ = (s)=>document.querySelector(s);
const headers = { "Authorization": `Bearer ${token}", "Content-Type":"application/json" };

$("#logout").addEventListener("click", (e)=>{ e.preventDefault(); logout(); });

let me = null;
let currentDepositId = null;

function centsToBRL(cents){
  return (Number(cents)/100).toLocaleString("pt-BR", { style:"currency", currency:"BRL" });
}

async function apiGet(url){
  const r = await fetch(url, { headers });
  const data = await r.json().catch(()=> ({}));
  if(!r.ok) throw new Error(data.error || "Erro");
  return data;
}
async function apiPost(url, body){
  const r = await fetch(url, { method:"POST", headers, body: JSON.stringify(body) });
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

async function loadMe(){
  me = await apiGet("/api/me");
  $("#emailPill").textContent = me.email;
  $("#wallet").value = me.depixAddress || "";
  $("#commissionPill").textContent = `${(me.commissionBps/100).toFixed(2)}%`;
  if(me.role === "admin") $("#adminLink").style.display = "inline";
}

async function saveWallet(){
  $("#walletMsg").textContent = "Salvando...";
  try{
    await apiPut("/api/me/wallet", { depixAddress: $("#wallet").value.trim() });
    $("#walletMsg").textContent = "Carteira salva ✔️";
  }catch(e){
    $("#walletMsg").textContent = e.message;
  }
}

function renderDepositBox(d){
  currentDepositId = d.id;
  $("#depId").textContent = d.id;
  $("#qrImg").src = d.qrImageUrl || "";
  $("#qrCopy").value = d.qrCopyPaste || "";
  $("#payBox").style.display = "block";
  $("#depStatusPill").textContent = d.status || "—";
  $("#gross").textContent = centsToBRL(d.amountInCents);
  $("#fee").textContent = centsToBRL(d.feeInCents);
  $("#net").textContent = centsToBRL(d.netInCents);
}

async function createDeposit(){
  $("#depMsg").textContent = "Gerando PIX...";
  try{
    const d = await apiPost("/api/deposits", { amountBrl: $("#amount").value.trim() });
    $("#depMsg").textContent = "PIX gerado. Pague no app do banco.";
    renderDepositBox(d);
    await refreshDeposit();
    await loadDeposits();
  }catch(e){
    $("#depMsg").textContent = e.message;
  }
}

async function refreshDeposit(){
  if(!currentDepositId) return;
  try{
    const d = await apiGet(`/api/deposits/${encodeURIComponent(currentDepositId)}`);
    renderDepositBox(d);
  }catch{}
}

async function loadDeposits(){
  const rows = await apiGet("/api/deposits");
  const tb = $("#depTable tbody");
  tb.innerHTML = "";
  for(const r of rows){
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${new Date(r.createdAt).toLocaleString("pt-BR")}</td>
      <td>${centsToBRL(r.amountInCents)}</td>
      <td>${centsToBRL(r.netInCents)}</td>
      <td>${r.status}</td>
      <td><code>${r.id}</code></td>
    `;
    tr.style.cursor = "pointer";
    tr.addEventListener("click", ()=>{
      currentDepositId = r.id;
      $("#depMsg").textContent = "Depósito selecionado.";
      renderDepositBox(r);
      refreshDeposit();
    });
    tb.appendChild(tr);
  }
}

async function createWithdrawal(){
  $("#wdMsg").textContent = "Criando pedido...";
  try{
    const data = await apiPost("/api/withdrawals", {
      amountDepix: $("#wdAmount").value.trim(),
      pixDestination: $("#wdPix").value.trim()
    });
    $("#wdMsg").textContent = "Pedido criado. Envie DePix e depois envie TXID + comprovante.";
    $("#wdInstructions").style.display = "block";
    $("#platformWallet").textContent = data.platformDepixAddress || "—";
    await loadWithdrawals();
  }catch(e){
    $("#wdMsg").textContent = e.message;
  }
}

function fileToDataURL(file){
  return new Promise((resolve, reject)=>{
    const reader = new FileReader();
    reader.onload = ()=> resolve(String(reader.result));
    reader.onerror = ()=> reject(new Error("Falha ao ler arquivo"));
    reader.readAsDataURL(file);
  });
}

async function sendProof(){
  $("#proofMsg").textContent = "Enviando...";
  try{
    const id = Number($("#wdId").value);
    const txid = $("#wdTxid").value.trim();
    const f = $("#wdFile").files?.[0];
    if(!id) throw new Error("Informe o ID do pedido.");
    if(!txid) throw new Error("Informe o TXID.");
    if(!f) throw new Error("Selecione um comprovante.");
    const fileBase64 = await fileToDataURL(f);

    await apiPost(`/api/withdrawals/${id}/proof`, { txid, fileName: f.name, fileBase64 });
    $("#proofMsg").textContent = "Enviado ✔️ Aguarde análise/pagamento.";
    $("#wdTxid").value = "";
    $("#wdFile").value = "";
    await loadWithdrawals();
  }catch(e){
    $("#proofMsg").textContent = e.message;
  }
}

async function loadWithdrawals(){
  const rows = await apiGet("/api/withdrawals");
  const tb = $("#wdTable tbody");
  tb.innerHTML = "";
  for(const r of rows){
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${new Date(r.createdAt).toLocaleString("pt-BR")}</td>
      <td>${r.amountDepix} DePix</td>
      <td>${r.status}</td>
      <td><code>${r.id}</code></td>
    `;
    tr.style.cursor = "pointer";
    tr.addEventListener("click", ()=>{
      $("#wdId").value = r.id;
      $("#proofMsg").textContent = "Saque selecionado. Envie TXID + comprovante.";
    });
    tb.appendChild(tr);
  }
}

$("#saveWallet").addEventListener("click", saveWallet);
$("#createDeposit").addEventListener("click", createDeposit);
$("#refreshDeposit").addEventListener("click", refreshDeposit);
$("#createWithdrawal").addEventListener("click", createWithdrawal);
$("#sendProof").addEventListener("click", sendProof);

$("#copyBtn").addEventListener("click", async ()=>{
  await navigator.clipboard.writeText($("#qrCopy").value);
  $("#copyBtn").textContent = "Copiado ✔️";
  setTimeout(()=> $("#copyBtn").textContent = "Copiar", 1200);
});

await loadMe();
await loadDeposits();
await loadWithdrawals();
setInterval(refreshDeposit, 5000);
