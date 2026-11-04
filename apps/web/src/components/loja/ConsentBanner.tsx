"use client";

import { useEffect, useState } from "react";
import { CONSENT_KEY, hasConsent, setConsent } from "@/lib/analytics";

// Banner LGPD: bloqueia analytics até o aceite. Sem aceite, nenhum
// script de rastreamento é injetado (ver TrackingScripts).
export function ConsentBanner() {
  const [visivel, setVisivel] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(CONSENT_KEY) === null) setVisivel(true);
    } catch {
      // storage indisponível: não exibe, não rastreia
    }
  }, []);

  if (!visivel) return <button className="fixed bottom-2 left-2 z-40 rounded bg-white px-3 py-2 text-xs shadow" onClick={()=>setVisivel(true)}>Preferências de cookies</button>;

  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);
  async function escolher(aceito: boolean) {
    if (salvando) return;
    setSalvando(true);
    setErro("");
    if (!aceito) setConsent(false);
    try {
      const response = await fetch("/api/analytics/consent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ granted: aceito }),
      });
      if (!response.ok) throw new Error("consent_failed");
      if (aceito) setConsent(true);
      setVisivel(false);
    } catch {
      if (aceito) setConsent(false);
      setErro("Não foi possível salvar a preferência no servidor. Tente novamente.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 border-t border-ink/10 bg-white/95 p-4 shadow-2xl backdrop-blur">
      <div className="mx-auto flex max-w-4xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-ink-soft">
          Usamos cookies para melhorar sua experiência e medir visitas. Você pode aceitar ou recusar —{" "}
          <a href="/privacidade" className="underline">saiba mais</a>.
        </p>
        {erro && <p role="alert" className="text-xs text-red-700">{erro}</p>}
        <div className="flex shrink-0 gap-2">
          <button
            disabled={salvando} onClick={() => void escolher(false)}
            className="rounded-full border border-ink/20 px-4 py-2 text-xs font-semibold text-ink hover:bg-ink/5"
          >
            Recusar
          </button>
          <button
            disabled={salvando} onClick={() => void escolher(true)}
            className="rounded-full bg-ink px-4 py-2 text-xs font-semibold text-primary-50"
          >
            Aceitar
          </button>
        </div>
      </div>
    </div>
  );
}

export function analyticsConsentGiven(): boolean {
  return hasConsent();
}
