import { useEffect, useState } from "react";
import QRCode from "qrcode.react";

const API = import.meta.env.VITE_API_URL || "http://localhost:3333";

export default function Conexao() {
  const [tenant, setTenant] = useState("");
  const [status, setStatus] = useState("idle");
  const [qr, setQr] = useState<string | null>(null);
  const [pollId, setPollId] = useState<number | null>(null);

  async function start() {
    if (!tenant) return;
    await fetch(`${API}/wa/${tenant}/start`, { method: "POST" });
    beginPoll();
  }

  async function logout() {
    if (!tenant) return;
    await fetch(`${API}/wa/${tenant}/logout`, { method: "POST" });
    setStatus("idle");
    setQr(null);
    if (pollId) clearInterval(pollId);
  }

  function beginPoll() {
    if (pollId) clearInterval(pollId);
    const id = window.setInterval(async () => {
      const s = await fetch(`${API}/wa/${tenant}/status`).then(r => r.json());
      setStatus(s.status);
      if (s.status === "connected") {
        setQr(null);
        clearInterval(id);
        setPollId(null);
        return;
      }
      const q = await fetch(`${API}/wa/${tenant}/qr`).then(r => r.json());
      setQr(q.qr || null);
    }, 2500);
    setPollId(id);
  }

  useEffect(() => {
    return () => { if (pollId) clearInterval(pollId); };
  }, [pollId]);

  return (
    <div className="p-6 max-w-xl mx-auto space-y-4">
      <h1 className="text-2xl font-bold">Conectar WhatsApp por Tenant</h1>

      <div className="flex gap-2">
        <input
          className="border rounded px-3 py-2 flex-1"
          placeholder="tenant ex.: loja-01"
          value={tenant}
          onChange={(e) => setTenant(e.target.value.trim())}
        />
        <button onClick={start} className="px-4 py-2 rounded bg-black text-white">Conectar</button>
        <button onClick={logout} className="px-4 py-2 rounded border">Logout</button>
      </div>

      <div className="space-y-2">
        <div>Status: <b>{status}</b></div>
        {qr ? (
          <div className="flex flex-col items-center gap-2">
            <QRCode value={qr} size={256} />
            <span className="text-sm text-gray-500">Escaneie este QR no WhatsApp</span>
          </div>
        ) : (
          <p className="text-gray-500">Sem QR no momento.</p>
        )}
      </div>
    </div>
  );
}
