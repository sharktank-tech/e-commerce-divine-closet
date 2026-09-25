"use client";

import { useState } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";

export default function RecuperarPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/recuperar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Erro ao enviar");
        return;
      }
      setSent(true);
    } catch {
      setError("Erro de conexão");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-md px-4 py-16">
      <h1 className="font-display text-3xl font-bold text-ink">Recuperar senha</h1>
      <p className="mt-2 text-sm text-ink-mute">
        Informe seu e-mail para receber o link de redefinição (válido por 1 hora).
      </p>

      {sent ? (
        <div className="mt-8 rounded-xl border border-ink/10 bg-white p-6 text-center">
          <p className="text-3xl">✉️</p>
          <p className="mt-3 font-semibold text-ink">Verifique seu e-mail</p>
          <p className="mt-1 text-sm text-ink-mute">
            Se o e-mail estiver cadastrado, você receberá o link de redefinição em
            instantes. Não esqueça de olhar a caixa de spam.
          </p>
          <Link
            href="/login"
            className="mt-5 inline-block font-semibold text-divine-700 hover:underline"
          >
            Voltar ao login
          </Link>
        </div>
      ) : (
        <form onSubmit={submit} className="mt-8 space-y-4">
          <Input
            label="E-mail"
            type="email"
            required
            value={email}
            onChange={setEmail}
            autoComplete="email"
            placeholder="voce@email.com"
          />

          {error && (
            <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>
          )}

          <Button type="submit" className="w-full" size="lg" disabled={loading}>
            {loading ? "Enviando..." : "Enviar link"}
          </Button>

          <p className="text-center text-sm text-ink-mute">
            <Link href="/login" className="font-semibold text-divine-700 hover:underline">
              Voltar ao login
            </Link>
          </p>
        </form>
      )}
    </div>
  );
}
