"use client";

// Analytics com consentimento (LGPD).
// Nenhum evento é disparado sem aceite explícito (localStorage `dc-consent=1`)
// e sem IDs configurados. Sem IDs, tudo vira no-op silencioso.

export const CONSENT_KEY = "dc-consent";

export function hasConsent(): boolean {
  try {
    return localStorage.getItem(CONSENT_KEY) === "1";
  } catch {
    return false;
  }
}

export function setConsent(aceito: boolean) {
  try {
    localStorage.setItem(CONSENT_KEY, aceito ? "1" : "0");
  } catch {
    // storage indisponível: segue sem analytics
  }
}

declare global {
  interface Window {
    dataLayer?: Array<Record<string, unknown>>;
  }
}

function push(event: Record<string, unknown>) {
  if (!hasConsent()) return;
  try {
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push(event);
  } catch {
    // silencioso
  }
}

export const analytics = {
  addToCart(items: Array<{ id: string; name: string; price: number; quantity: number }>) {
    push({ event: "add_to_cart", ecommerce: { items } });
  },
  beginCheckout(value: number, items: Array<{ id: string; name: string; price: number; quantity: number }>) {
    push({ event: "begin_checkout", ecommerce: { value, currency: "BRL", items } });
  },
  purchase(orderId: string, value: number, items: Array<{ id: string; name: string; price: number; quantity: number }>) {
    // Deduplicação: recarregar a confirmação não dispara de novo.
    try {
      const key = `dc-purchase-${orderId}`;
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
    } catch {
      // segue mesmo assim
    }
    push({ event: "purchase", ecommerce: { transaction_id: orderId, value, currency: "BRL", items } });
  },
};
