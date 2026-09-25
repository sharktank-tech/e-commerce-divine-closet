"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { features } from "@/config/defaults";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/conta";

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
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Erro ao entrar");
        return;
      }
      router.push(data.user.role === "ADMIN" ? "/admin" : next);
      router.refresh();
    } catch {
      setError("Erro de conexão");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-md px-4 py-16">
      <h1 className="font-display text-3xl font-bold text-ink">Bem-vinda de volta</h1>
      <p className="mt-2 text-sm text-ink-mute">
        Entre para acompanhar seus pedidos e facilitar a compra.
      </p>

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
        <Input
          label="Senha"
          type="password"
          required
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
          placeholder="••••••••"
        />

        {error && (
          <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>
        )}

        <div className="text-right">
          <Link href="/recuperar" className="text-xs text-ink-mute hover:text-ink underline">
            Esqueci a senha
          </Link>
        </div>

        <Button type="submit" className="w-full" size="lg" disabled={loading}>
          {loading ? "Entrando..." : "Entrar"}
        </Button>
      </form>

      <div className="mt-6">
        <div className="flex items-center gap-3 text-xs text-ink-mute">
          <span className="h-px flex-1 bg-ink/10" />
          ou
          <span className="h-px flex-1 bg-ink/10" />
        </div>
        <button
          type="button"
          disabled={!features.socialLogin}
          title={
            features.socialLogin
              ? "Entrar com Google"
              : "Login social desativado — TODO-CLIENTE: credenciais OAuth Google"
          }
          className="mt-4 w-full rounded-lg border border-ink/15 bg-white px-4 py-2.5 text-sm font-semibold text-ink-soft disabled:cursor-not-allowed disabled:opacity-60"
        >
          Continuar com Google
          {!features.socialLogin && (
            <span className="ml-2 text-[11px] font-normal text-ink-mute">(em breve)</span>
          )}
        </button>
      </div>

      <p className="mt-6 text-center text-sm text-ink-mute">
        Não tem conta?{" "}
        <Link href="/registro" className="font-semibold text-divine-700 hover:underline">
          Criar conta grátis
        </Link>
      </p>

      <p className="mt-4 text-center">
        <Link href="/admin/login" className="text-xs text-ink-mute hover:text-ink underline">
          Acesso do administrador
        </Link>
      </p>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
