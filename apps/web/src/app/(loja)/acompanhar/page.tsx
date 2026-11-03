"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

// Pedido sem conta (convidado): pedir reenvio do link privado. A resposta
// é SEMPRE a mesma com ou sem pedidos — não revela se o email existe.
export default function AcompanharPage() {
  const [email, setEmail] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [feito, setFeito] = useState(false);
  const [erro, setErro] = useState("");

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (enviando) return;
    setEnviando(true);
    setErro("");
    try {
      const res = await fetch("/api/acompanhar/reenviar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setErro(body.error || "Não foi possível enviar agora. Tente novamente.");
        return;
      }
      setFeito(true);
    } catch {
      setErro("Falha de conexão. Tente novamente.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <main className="mx-auto max-w-md px-4 py-12">
      <h1 className="text-2xl font-semibold text-ink">Acompanhar pedido</h1>
      <p className="mt-2 text-sm text-ink-soft">
        Compreu sem criar conta? Informe o e-mail usado na compra para receber o
        link privado de acompanhamento dos seus pedidos.
      </p>

      {feito ? (
        <div className="mt-6 rounded-xl border border-ink/10 bg-white p-5 text-sm text-ink-soft">
          Se houver pedidos com este e-mail, o link foi enviado. Confira também a
          caixa de spam — pode levar alguns minutos.
        </div>
      ) : (
        <form onSubmit={enviar} className="mt-6 space-y-4">
          <Input
            label="E-mail da compra"
            name="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={setEmail}
            placeholder="voce@email.com"
          />
          {erro && <p className="text-sm text-red-700">{erro}</p>}
          <Button type="submit" disabled={enviando} className="w-full">
            {enviando ? "Enviando..." : "Enviar link"}
          </Button>
        </form>
      )}

      <p className="mt-6 text-xs text-ink-mute">
        O link vale por 30 dias e é privado — pedir um novo invalida o anterior.
      </p>
    </main>
  );
}
