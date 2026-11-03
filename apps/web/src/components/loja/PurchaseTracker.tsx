"use client";
import { useEffect, useRef } from "react";
import { analytics, CONSENT_EVENT, hasConsent } from "@/lib/analytics";

const RETRY_INTERVAL_MS = 5_000;
const MAX_ATTEMPTS = 12;

export function PurchaseTracker({
  pedido,
  onPaid,
}: {
  pedido?: string;
  total?: string;
  onPaid?: () => void;
}) {
  const onPaidRef = useRef(onPaid);
  onPaidRef.current = onPaid;
  useEffect(() => {
    if (!pedido) return;

    let stopped = false;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    let inFlight = false;

    const stop = () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      controller?.abort();
      window.removeEventListener(CONSENT_EVENT, onConsent);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("dc-tracking-ready", onTrackingReady);
    };

    const checkoutProof = () => {
      try {
        const saved = JSON.parse(
          sessionStorage.getItem(`dc-conversion-proof:${pedido}`) || "null",
        );
        if (saved?.expires > Date.now() && typeof saved.key === "string")
          return saved.key as string;
      } catch {
        // Sem prova de posse, o servidor exige sessão autenticada.
      }
      return undefined;
    };

    const schedule = () => {
      if (!stopped && attempts < MAX_ATTEMPTS && !timer) {
        timer = setTimeout(() => {
          timer = undefined;
          void check();
        }, RETRY_INTERVAL_MS);
      }
    };

    const check = async () => {
      if (stopped || inFlight || document.hidden) return;
      // A consulta do status Pix é parte do checkout e independe de consentimento de analytics.
      // O evento GA4 continua condicionado ao aceite em analytics.purchase().

      inFlight = true;
      attempts++;
      controller = new AbortController();
      try {
        const response = await fetch("/api/marketing/conversao", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ number: pedido, checkoutKey: checkoutProof() }),
          signal: controller.signal,
        });
        if (stopped) return;
        // Erros de autorização não devem gerar tentativas em loop.
        if (response.status === 404 || response.status === 401 || response.status === 403) {
          stop();
          return;
        }
        if (response.ok) {
          const data = await response.json();
          if (data?.paid) {
            if (hasConsent()) analytics.purchase(data.id, data.total, data.items);
            stop();
            onPaidRef.current?.();
            return;
          }
        }
      } catch {
        // Falha transitória: retentar dentro do limite.
      } finally {
        inFlight = false;
        if (!stopped) schedule();
      }
    };

    function onConsent() {
      void check();
    }

    function onVisible() {
      if (!document.hidden) void check();
    }

    function onTrackingReady() {
      void check();
    }

    window.addEventListener(CONSENT_EVENT, onConsent);
    window.addEventListener("dc-tracking-ready", onTrackingReady);
    document.addEventListener("visibilitychange", onVisible);
    void check();
    return stop;
  }, [pedido]);
  return null;
}
