"use client";

import { hasConsent } from "@/lib/analytics";

const GA4_ID = "G-BKNS2XTSH2";

/** Consulta o identificador já criado pelo gtag após o aceite; nunca gera outro. */
export async function checkoutGa4ClientId(): Promise<string | null> {
  if (!hasConsent() || !window.gtag || !window.dcTracking?.ga4.includes(GA4_ID))
    return null;
  // Nunca concede consentimento automaticamente a partir do localStorage:
  // ele pode estar desatualizado após revogação em outra aba/dispositivo.
  // O servidor só confirma tokens previamente emitidos por ação explícita.
  try {
    const response = await fetch("/api/analytics/consent", {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
    });
    if (!response.ok || !hasConsent()) return null;
    const status: unknown = await response.json();
    if (!status || typeof status !== "object" ||
        !("granted" in status) || (status as { granted?: unknown }).granted !== true)
      return null;
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
