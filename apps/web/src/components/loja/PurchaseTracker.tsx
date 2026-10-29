"use client";
import { useEffect } from "react";
import { analytics, hasConsent } from "@/lib/analytics";
export function PurchaseTracker({
  pedido,
}: {
  pedido?: string;
  total?: string;
}) {
  useEffect(() => {
    if (!pedido || !hasConsent()) return;
    let checkoutKey: string | undefined;
    try {
      const saved = JSON.parse(
        sessionStorage.getItem(`dc-conversion-proof:${pedido}`) || "null",
      );
      if (saved?.expires > Date.now()) checkoutKey = saved.key;
    } catch {
      /* sem prova de posse: servidor nega */
    }
    const abort = new AbortController();
    fetch("/api/marketing/conversao", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ number: pedido, checkoutKey }),
      signal: abort.signal,
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.paid) analytics.purchase(d.id, d.total, d.items);
      })
      .catch(() => undefined);
    return () => abort.abort();
  }, [pedido]);
  return null;
}
