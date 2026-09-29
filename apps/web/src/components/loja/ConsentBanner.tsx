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

  if (!visivel) return null;

  function escolher(aceito: boolean) {
    setConsent(aceito);
    setVisivel(false);
    if (aceito) window.location.reload();
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 border-t border-ink/10 bg-white/95 p-4 shadow-2xl backdrop-blur">
      <div className="mx-auto flex max-w-4xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-ink-soft">
          Usamos cookies para melhorar sua experiência e medir visitas. Você pode aceitar ou recusar —{" "}
          <a href="/privacidade" className="underline">saiba mais</a>.
        </p>
        <div className="flex shrink-0 gap-2">
          <button
            onClick={() => escolher(false)}
            className="rounded-full border border-ink/20 px-4 py-2 text-xs font-semibold text-ink hover:bg-ink/5"
          >
            Recusar
          </button>
          <button
            onClick={() => escolher(true)}
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
