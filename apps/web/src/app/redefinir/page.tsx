"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";

function RedefinirForm() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("token") || "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (password !== confirm) {
      setError("As senhas não conferem");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/redefinir", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Erro ao redefinir");
        return;
      }
      setDone(true);
      setTimeout(() => router.push("/login"), 2500);
    } catch {
      setError("Erro de conexão");
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center">
        <h1 className="font-display text-2xl font-bold text-ink">Link inválido</h1>
        <p className="mt-2 text-sm text-ink-mute">
          Este link está incompleto. Solicite um novo abaixo.
        </p>
        <Link
          href="/recuperar"
          className="mt-5 inline-block font-semibold text-divine-700 hover:underline"
        >
          Solicitar novo link
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md px-4 py-16">
      <h1 className="font-display text-3xl font-bold text-ink">Nova senha</h1>
      <p className="mt-2 text-sm text-ink-mute">Escolha uma senha com ao menos 6 caracteres.</p>

      {done ? (
        <div className="mt-8 rounded-xl border border-ink/10 bg-white p-6 text-center">
          <p className="text-3xl">✓</p>
          <p className="mt-3 font-semibold text-ink">Senha redefinida!</p>
          <p className="mt-1 text-sm text-ink-mute">Redirecionando para o login...</p>
        </div>
      ) : (
        <form onSubmit={submit} className="mt-8 space-y-4">
          <Input
            label="Nova senha"
            type="password"
            required
            value={password}
            onChange={setPassword}
            autoComplete="new-password"
            placeholder="••••••••"
          />
          <Input
            label="Confirmar nova senha"
            type="password"
            required
            value={confirm}
            onChange={setConfirm}
            autoComplete="new-password"
            placeholder="••••••••"
          />

          {error && (
            <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>
          )}

          <Button type="submit" className="w-full" size="lg" disabled={loading}>
            {loading ? "Salvando..." : "Redefinir senha"}
          </Button>
        </form>
      )}
    </div>
  );
}

export default function RedefinirPage() {
  return (
    <Suspense>
      <RedefinirForm />
    </Suspense>
  );
}
