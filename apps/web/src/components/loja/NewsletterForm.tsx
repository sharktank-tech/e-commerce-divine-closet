"use client";
import { useState } from "react";
import { CONSENT_TEXT, CONSENT_VERSION } from "@/lib/marketing/consent";
export function NewsletterForm() {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  return (
    <form
      className="mt-6 space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = e.currentTarget;
        const d = new FormData(f);
        setBusy(true);
        try {
          const r = await fetch("/api/newsletter/subscribe", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              email: d.get("email"),
              consent: d.get("consent") === "on",
              consentVersion: CONSENT_VERSION,
              source: "footer",
              reactivate: d.get("reactivate") === "on",
            }),
          });
          const b = await r.json();
          setMessage(b.message || b.error);
          if (r.ok) f.reset();
        } catch {
          setMessage("Não foi possível cadastrar. Tente novamente.");
        } finally {
          setBusy(false);
        }
      }}
    >
      <p className="font-semibold">Receba novidades e ofertas</p>
      <label className="block">
        Seu e-mail
        <input
          className="block rounded p-2 text-black w-full"
          type="email"
          name="email"
          required
          maxLength={254}
        />
      </label>
      <label className="flex gap-2 text-sm">
        <input type="checkbox" name="consent" required />
        {CONSENT_TEXT}
      </label>
      <label className="flex gap-2 text-sm">
        <input type="checkbox" name="reactivate" />
        Quero reativar uma inscrição que cancelei.
      </label>
      <button
        className="rounded bg-white text-primary-950 px-4 py-2"
        disabled={busy}
      >
        {busy ? "Aguarde…" : "Quero receber"}
      </button>
      <p role="status">{message}</p>
    </form>
  );
}
