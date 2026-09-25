"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";

function AdminLoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, asAdmin: true }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Credenciais inválidas");
        return;
      }
      router.push(params.get("next") || "/admin");
      router.refresh();
    } catch {
      setError("Erro de conexão");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-ink px-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-2xl">
        <p className="text-center font-display text-2xl font-bold text-ink">
          Divine<span className="text-divine-600">Closet</span>
        </p>
        <p className="mt-1 text-center text-xs uppercase tracking-widest text-ink-mute">
          Painel administrativo
        </p>

        <form onSubmit={submit} className="mt-8 space-y-4">
          <Input label="E-mail" type="email" required value={email} onChange={setEmail} />
          <Input label="Senha" type="password" required value={password} onChange={setPassword} />

          {error && (
            <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>
          )}

          <Button type="submit" className="w-full" size="lg" disabled={loading}>
            {loading ? "Entrando..." : "Entrar no painel"}
          </Button>
        </form>

        <p className="mt-6 text-center text-xs">
          <Link href="/" className="text-ink-mute hover:text-ink underline">
            ← Voltar para a loja
          </Link>
        </p>
      </div>
    </div>
  );
}

export default function AdminLoginPage() {
  return (
    <Suspense>
      <AdminLoginForm />
    </Suspense>
  );
}
