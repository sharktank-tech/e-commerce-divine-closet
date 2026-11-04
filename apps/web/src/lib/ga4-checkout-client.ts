"use client";

import { hasConsent } from "@/lib/analytics";

const GA4_ID = "G-BKNS2XTSH2";

/** Consulta o identificador já criado pelo gtag após o aceite; nunca gera outro. */
export async function checkoutGa4ClientId(): Promise<string | null> {
  if (!hasConsent() || !window.gtag || !window.dcTracking?.ga4.includes(GA4_ID))
    return null;
  // Migra aceites existentes do localStorage para uma autorização assinada
  // no servidor. Falha não bloqueia a compra nem envia identidade à API.
  try {
    const response = await fetch("/api/analytics/consent", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ granted: true }),
    });
    if (!response.ok || !hasConsent()) return null;
  } catch { return null; }
  return new Promise((resolve) => {
    let done = false;
    const finish = (value: string | null) => {
      if (done) return;
      done = true;
      clearTimeout(timeout);
      resolve(value && /^\d+\.\d+$/.test(value) && value.length <= 128 ? value : null);
    };
    const timeout = setTimeout(() => finish(null), 750);
    try {
      window.gtag?.("get", GA4_ID, "client_id", (value: unknown) => {
        finish(typeof value === "string" ? value : null);
      });
    } catch { finish(null); }
  });
}
