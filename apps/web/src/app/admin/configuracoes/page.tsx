"use client";

import { useEffect, useState } from "react";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";

type Settings = {
  empresa: { name: string; cnpj: string; email: string; phone: string; address: string; logoUrl: string };
  pixels: { metaPixelId: string; googleAdsId: string; ga4Id: string };
  frete: { fixed: number; freeFrom: number; prazoDias: string };
  pagamento: { card: boolean; pix: boolean; boleto: boolean };
  emailMarketing: { provider: string; senderName: string; senderEmail: string };
};

type StaffUser = { id: string; name: string; email: string; role: string; active: boolean };

const roleLabel: Record<string, string> = {
  ADMIN: "Administrador",
  OPERATOR: "Operador",
  MARKETING: "Marketing",
  CLIENT: "Cliente",
};

export default function AdminConfiguracoesPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [users, setUsers] = useState<StaffUser[]>([]);
  const [msg, setMsg] = useState("");
  const [saving, setSaving] = useState(false);

  const [mail, setMail] = useState({ to: "", subject: "", body: "" });
  const [mailMsg, setMailMsg] = useState("");

  useEffect(() => {
    Promise.all([
      fetch("/api/admin/configuracoes"),
      fetch("/api/admin/usuarios"),
    ]).then(async ([cfgRes, usersRes]) => {
      if (cfgRes.ok) setSettings((await cfgRes.json()).settings);
      if (usersRes.ok) setUsers((await usersRes.json()).users || []);
    });
  }, []);

  function set<K extends keyof Settings>(key: K, patch: Partial<Settings[K]>) {
    setSettings((s) => (s ? { ...s, [key]: { ...s[key], ...patch } } : s));
  }

  async function save() {
    if (!settings) return;
    setSaving(true);
    setMsg("");
    try {
      const res = await fetch("/api/admin/configuracoes", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      setMsg(res.ok ? "Configurações salvas." : "Erro ao salvar.");
    } finally {
      setSaving(false);
    }
  }

  async function sendTest(e: React.FormEvent) {
    e.preventDefault();
    setMailMsg("");
    const res = await fetch("/api/admin/marketing/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(mail),
    });
    const data = await res.json();
    setMailMsg(data.message || data.error || "Erro ao enviar");
    if (res.ok) setMail({ to: "", subject: "", body: "" });
  }

  if (!settings) return <p className="text-ink-mute">Carregando configurações...</p>;

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-ink">Configurações</h1>
          <p className="text-sm text-ink-mute">Dados da loja, pixels, frete, pagamentos e equipe</p>
        </div>
        <Button onClick={save} disabled={saving}>
          {saving ? "Salvando..." : "Salvar tudo"}
        </Button>
      </div>
      {msg && <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{msg}</p>}

      <section className="rounded-xl border border-ink/10 bg-white p-5">
        <h2 className="font-semibold text-ink">Dados da empresa</h2>
        <p className="text-xs text-ink-mute">TODO-CLIENTE: razão social, CNPJ e endereço reais</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Input label="Nome fantasia" value={settings.empresa.name} onChange={(v) => set("empresa", { name: v })} />
          <Input label="CNPJ" value={settings.empresa.cnpj} onChange={(v) => set("empresa", { cnpj: v })} />
          <Input label="E-mail" value={settings.empresa.email} onChange={(v) => set("empresa", { email: v })} />
          <Input label="Telefone" value={settings.empresa.phone} onChange={(v) => set("empresa", { phone: v })} />
          <div className="sm:col-span-2">
            <Input label="Endereço" value={settings.empresa.address} onChange={(v) => set("empresa", { address: v })} />
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-ink/10 bg-white p-5">
        <h2 className="font-semibold text-ink">Pixels de rastreamento</h2>
        <p className="text-xs text-ink-mute">
          TODO-CLIENTE: IDs do Meta Pixel, Google Ads e GA4. Vazios = scripts não injetados.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <Input label="Meta Pixel ID" value={settings.pixels.metaPixelId} onChange={(v) => set("pixels", { metaPixelId: v })} placeholder="1234567890" />
          <Input label="Google Ads ID" value={settings.pixels.googleAdsId} onChange={(v) => set("pixels", { googleAdsId: v })} placeholder="AW-XXXX" />
          <Input label="GA4 ID" value={settings.pixels.ga4Id} onChange={(v) => set("pixels", { ga4Id: v })} placeholder="G-XXXX" />
        </div>
      </section>

      <section className="rounded-xl border border-ink/10 bg-white p-5">
        <h2 className="font-semibold text-ink">Regras de frete</h2>
        <p className="text-xs text-ink-mute">TODO-CLIENTE: tabela real da transportadora</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <Input label="Frete fixo (R$)" type="number" step="0.01" min="0" value={String(settings.frete.fixed)} onChange={(v) => set("frete", { fixed: Number(v) || 0 })} />
          <Input label="Frete grátis acima de (R$)" type="number" step="0.01" min="0" value={String(settings.frete.freeFrom)} onChange={(v) => set("frete", { freeFrom: Number(v) || 0 })} />
          <Input label="Prazo (dias)" value={settings.frete.prazoDias} onChange={(v) => set("frete", { prazoDias: v })} />
        </div>
        <p className="mt-2 text-[11px] text-ink-mute">
          Obs.: o cálculo do checkout usa os defaults de <code>packages/config</code> — sincronize os dois ao trocar a regra.
        </p>
      </section>

      <section className="rounded-xl border border-ink/10 bg-white p-5">
        <h2 className="font-semibold text-ink">Formas de pagamento habilitadas</h2>
        <div className="mt-3 flex flex-wrap gap-5">
          {(["card", "pix", "boleto"] as const).map((m) => (
            <label key={m} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={settings.pagamento[m]}
                onChange={(e) => set("pagamento", { [m]: e.target.checked })}
              />
              {m === "card" ? "Cartão" : m === "pix" ? "Pix" : "Boleto"}
            </label>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-ink-mute">
          TODO-CLIENTE: gateway real + credenciais (hoje tudo em sandbox/mock).
        </p>
      </section>

      <section className="rounded-xl border border-ink/10 bg-white p-5">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-ink">E-mail marketing</h2>
          <Badge status="HIDDEN">Driver mock</Badge>
        </div>
        <p className="text-xs text-ink-mute">
          TODO-CLIENTE: provedor real (Mailchimp/SES). Em dev o envio vai para o log.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <Input label="Provedor" value={settings.emailMarketing.provider} onChange={(v) => set("emailMarketing", { provider: v })} placeholder="mailchimp" />
          <Input label="Remetente" value={settings.emailMarketing.senderName} onChange={(v) => set("emailMarketing", { senderName: v })} />
          <Input label="E-mail remetente" value={settings.emailMarketing.senderEmail} onChange={(v) => set("emailMarketing", { senderEmail: v })} />
        </div>

        <form onSubmit={sendTest} className="mt-4 space-y-3 border-t border-ink/10 pt-4">
          <p className="text-sm font-semibold text-ink">Disparo de teste (mock)</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="Para" type="email" required value={mail.to} onChange={(v) => setMail((m) => ({ ...m, to: v }))} />
            <Input label="Assunto" required value={mail.subject} onChange={(v) => setMail((m) => ({ ...m, subject: v }))} />
          </div>
          <Input label="Corpo" textarea required value={mail.body} onChange={(v) => setMail((m) => ({ ...m, body: v }))} />
          <div className="flex items-center gap-3">
            <Button type="submit" size="sm">Enviar teste</Button>
            {mailMsg && <span className="text-xs text-ink-soft">{mailMsg}</span>}
          </div>
        </form>
      </section>

      <section className="rounded-xl border border-ink/10 bg-white p-5">
        <h2 className="font-semibold text-ink">Usuários e permissões (RBAC)</h2>
        <ul className="mt-3 space-y-3 text-sm">
          {users.map((u) => (
            <li key={u.id} className="flex items-center justify-between gap-3">
              <div>
                <p className="font-medium text-ink">{u.name}</p>
                <p className="text-xs text-ink-mute">{u.email}</p>
              </div>
              <Badge status={u.role === "ADMIN" ? "ACTIVE" : "HIDDEN"}>{roleLabel[u.role] || u.role}</Badge>
            </li>
          ))}
          {users.length === 0 && <li className="text-ink-mute">Nenhum usuário de painel.</li>}
        </ul>
        <p className="mt-3 text-[11px] text-ink-mute">
          Perfis: Administrador (tudo), Operador (produtos/pedidos), Marketing (campanhas/conteúdo).
        </p>
      </section>
    </div>
  );
}
