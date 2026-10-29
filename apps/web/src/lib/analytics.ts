"use client";
export const CONSENT_KEY = "dc-consent";
export const CONSENT_EVENT = "dc-consent-change";
export function hasConsent() {
  try {
    return localStorage.getItem(CONSENT_KEY) === "1";
  } catch {
    return false;
  }
}
export function privateAnalyticsPath(path: string) {
  return /^\/(acompanhar|newsletter|admin|conta|checkout|sucesso)(\/|$)/.test(
    path,
  );
}
export function setConsent(accepted: boolean) {
  try {
    localStorage.setItem(CONSENT_KEY, accepted ? "1" : "0");
    if (!accepted) sessionStorage.removeItem("dc-utm");
    window.dispatchEvent(new Event(CONSENT_EVENT));
  } catch {
    /* indisponível: não rastrear */
  }
}
type Item = { id: string; name: string; price: number; quantity: number };
declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
    fbq?: (...args: unknown[]) => void;
    dcTracking?: { ga4: string[]; ads: string[]; meta: string };
  }
}
function emit(event: string, value: number, items: Item[], orderId?: string) {
  if (
    !hasConsent() ||
    !window.dcTracking ||
    /^\/(acompanhar|newsletter|admin)(\/|$)/.test(location.pathname)
  )
    return false;
  const config = window.dcTracking;
  let emitted = false;
  const ecommerce = {
    currency: "BRL",
    value,
    items: items.map((i) => ({
      item_id: i.id,
      item_name: i.name,
      price: i.price,
      quantity: i.quantity,
    })),
    ...(orderId ? { transaction_id: orderId } : {}),
  };
  if (config.ga4.length && window.gtag) {
    window.gtag("event", event, {
      ...ecommerce,
      send_to: config.ga4,
      page_location: location.origin + location.pathname,
      page_referrer: "",
    });
    emitted = true;
  }
  if (config.meta && window.fbq) {
    const name = (
      {
        view_item: "ViewContent",
        add_to_cart: "AddToCart",
        begin_checkout: "InitiateCheckout",
        purchase: "Purchase",
      } as Record<string, string>
    )[event];
    if (name) {
      window.fbq(
        "track",
        name,
        {
          currency: "BRL",
          value,
          content_ids: items.map((i) => i.id),
          content_type: "product",
        },
        orderId ? { eventID: orderId } : undefined,
      );
      emitted = true;
    }
  }
  return emitted;
}
export function captureUtm() {
  if (!hasConsent() || privateAnalyticsPath(location.pathname)) return;
  try {
    const params = new URLSearchParams(location.search);
    if (!params.get("utm_source")) return;
    const clean = (s: string | null) =>
      (s || "").replace(/[^a-zA-Z0-9_ .-]/g, "").slice(0, 100);
    sessionStorage.setItem(
      "dc-utm",
      JSON.stringify({
        source: clean(params.get("utm_source")),
        medium: clean(params.get("utm_medium")),
        campaign: clean(params.get("utm_campaign")),
      }),
    );
  } catch {
    /* storage indisponível */
  }
}
export function checkoutUtm() {
  if (!hasConsent()) return undefined;
  try {
    return JSON.parse(sessionStorage.getItem("dc-utm") || "null") || undefined;
  } catch {
    return undefined;
  }
}
export const analytics = {
  viewItem: (item: Item) => emit("view_item", item.price, [item]),
  addToCart: (items: Item[]) =>
    emit(
      "add_to_cart",
      items.reduce((s, i) => s + i.price * i.quantity, 0),
      items,
    ),
  beginCheckout: (value: number, items: Item[]) =>
    emit("begin_checkout", value, items),
  // Chamado somente com dados da consulta autorizada ao servidor.
  purchase: (id: string, value: number, items: Item[]) => {
    if (!hasConsent()) return;
    const key = `dc-purchase-${id}`;
    try {
      if (localStorage.getItem(key)) return;
    } catch {
      /* segue */
    }
    if (emit("purchase", value, items, id)) {
      try {
        localStorage.setItem(key, "1");
      } catch {
        /* deduplicação no provedor por transaction_id/eventID */
      }
    }
  },
};
