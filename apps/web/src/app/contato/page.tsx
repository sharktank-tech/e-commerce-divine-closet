"use client";

import { useState } from "react";
import { institutional } from "@/config/defaults";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";

export default function ContatoPage() {
  const [sent, setSent] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", message: "" });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    // TODO-CLIENTE: endpoint real de contato / SMTP
    console.log("[CONTATO MOCK]", form);
    setSent(true);
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-14 sm:px-6">
      <h1 className="font-display text-3xl font-bold text-primary">Contato</h1>

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-ink/10 bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-ink-mute">E-mail</p>
          <p className="mt-1 text-sm font-medium">{institutional.contact.email}</p>
        </div>
        <div className="rounded-xl border border-ink/10 bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-ink-mute">Telefone</p>
          <p className="mt-1 text-sm font-medium">{institutional.contact.phone}</p>
        </div>
        <div className="rounded-xl border border-ink/10 bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-ink-mute">WhatsApp</p>
          <p className="mt-1 text-sm font-medium">{institutional.contact.whatsapp}</p>
        </div>
      </div>

      <p className="mt-4 text-sm text-ink-mute">{institutional.contact.address}</p>

      {sent ? (
        <div className="mt-8 rounded-xl border border-emerald-200 bg-emerald-50 p-6 text-sm text-emerald-800">
          Mensagem registrada (mock — sem envio real até configurar SMTP).
        </div>
      ) : (
        <form onSubmit={submit} className="mt-8 space-y-4 rounded-xl border border-ink/10 bg-white p-6">
          <Input label="Nome" required value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
          <Input label="E-mail" type="email" required value={form.email} onChange={(v) => setForm({ ...form, email: v })} />
          <Input label="Mensagem" textarea required value={form.message} onChange={(v) => setForm({ ...form, message: v })} />
          <Button type="submit">Enviar mensagem</Button>
        </form>
      )}
    </div>
  );
}
