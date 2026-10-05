"use client";

import { useEffect, useState } from "react";
import { institutional } from "@/config/defaults";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";

type EmpresaContato = {
  name: string;
  email: string;
  phone: string;
  whatsapp: string;
  address: string;
};

export default function ContatoPage() {
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");
  const [form, setForm] = useState({ name: "", email: "", message: "" });
  const [empresa, setEmpresa] = useState<EmpresaContato | null>(null);

  // Dados do painel (/admin/configuracoes → empresa); mock só enquanto carrega.
  useEffect(() => {
    fetch("/api/config-loja")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.empresa) setEmpresa(d.empresa);
      })
      .catch(() => {});
  }, []);

  const contato: EmpresaContato = empresa ?? {
    name: "Divine Closet",
    email: institutional.contact.email,
    phone: institutional.contact.phone,
    whatsapp: institutional.contact.whatsapp,
    address: institutional.contact.address,
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSendError("");
    setSending(true);
    try {
      const res = await fetch("/api/contato", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setSendError(data?.error || "Não foi possível enviar. Tente novamente.");
        return;
      }
      setSent(true);
    } catch {
      setSendError("Erro de conexão. Tente novamente.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-14 sm:px-6">
      <h1 className="font-display text-3xl font-bold text-primary">Contato</h1>

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-ink/10 bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-ink-mute">E-mail</p>
          <p className="mt-1 text-sm font-medium">{contato.email}</p>
        </div>
        <div className="rounded-xl border border-ink/10 bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-ink-mute">Telefone</p>
          <p className="mt-1 text-sm font-medium">{contato.phone}</p>
        </div>
        {contato.whatsapp && (
          <div className="rounded-xl border border-ink/10 bg-white p-4">
            <p className="text-xs uppercase tracking-wide text-ink-mute">WhatsApp</p>
            <p className="mt-1 text-sm font-medium">
              <a
                href={`https://wa.me/55${contato.whatsapp.replace(/\D/g, "")}?text=${encodeURIComponent(`Olá! Vim pelo site da ${contato.name}.`)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary-700 hover:underline"
              >
                {contato.whatsapp}
              </a>
            </p>
          </div>
        )}
      </div>

      <p className="mt-4 text-sm text-ink-mute">{contato.address}</p>

      {sent ? (
        <div className="mt-8 rounded-xl border border-emerald-200 bg-emerald-50 p-6 text-sm text-emerald-800">
          Mensagem enviada! Retornaremos em breve.
        </div>
      ) : (
        <form onSubmit={submit} className="mt-8 space-y-4 rounded-xl border border-ink/10 bg-white p-6">
          <Input label="Nome" required value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
          <Input label="E-mail" type="email" required value={form.email} onChange={(v) => setForm({ ...form, email: v })} />
          <Input label="Mensagem" textarea required value={form.message} onChange={(v) => setForm({ ...form, message: v })} />
          {sendError && <p className="text-sm text-red-600">{sendError}</p>}
          <Button type="submit" disabled={sending}>
            {sending ? "Enviando..." : "Enviar mensagem"}
          </Button>
        </form>
      )}
    </div>
  );
}
