const API = {
  async post(url, body){
    const r = await fetch(url, {
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body: JSON.stringify(body)
    });
    const data = await r.json().catch(()=> ({}));
    if(!r.ok) throw new Error(data.error || "Erro");
    return data;
  }
};

export function saveToken(token){ localStorage.setItem("token", token); }
export function getToken(){ return localStorage.getItem("token"); }
export function logout(){ localStorage.removeItem("token"); location.href="/login.html"; }

export async function login(email, password){
  const { token } = await API.post("/api/auth/login", { email, password });
  saveToken(token);
}
export async function register(payload){
  const { token } = await API.post("/api/auth/register", payload);
  saveToken(token);
}
