"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";

export default function RegistroPage() {
  const router = useRouter();
  const [form, setForm] = useState({ name: "", email: "", password: "", phone: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Erro ao criar conta");
        return;
      }
      router.push("/conta");
      router.refresh();
    } catch {
      setError("Erro de conexão");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-md px-4 py-16">
      <h1 className="font-display text-3xl font-bold text-ink">Criar conta</h1>
      <p className="mt-2 text-sm text-ink-mute">
        Cadastre-se para comprar mais rápido e acompanhar seus pedidos.
      </p>

      <form onSubmit={submit} className="mt-8 space-y-4">
        <Input
          label="Nome completo"
          required
          value={form.name}
          onChange={(v) => setForm({ ...form, name: v })}
          autoComplete="name"
        />
        <Input
          label="E-mail"
          type="email"
          required
          value={form.email}
          onChange={(v) => setForm({ ...form, email: v })}
          autoComplete="email"
        />
        <Input
          label="Telefone (opcional)"
          value={form.phone}
          onChange={(v) => setForm({ ...form, phone: v })}
          placeholder="(11) 99999-9999"
        />
        <Input
          label="Senha"
          type="password"
          required
          value={form.password}
          onChange={(v) => setForm({ ...form, password: v })}
          autoComplete="new-password"
          placeholder="Mínimo 6 caracteres"
        />

        {error && (
          <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>
        )}

        <Button type="submit" className="w-full" size="lg" disabled={loading}>
          {loading ? "Criando conta..." : "Criar conta"}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-ink-mute">
        Já tem conta?{" "}
        <Link href="/login" className="font-semibold text-divine-700 hover:underline">
          Entrar
        </Link>
      </p>
    </div>
  );
}
