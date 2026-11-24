"use client";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import {
  CONSENT_EVENT,
  CONSENT_KEY,
  captureUtm,
  hasConsent,
  privateAnalyticsPath,
  pauseTracking,
  setConsent,
} from "@/lib/analytics";
export function TrackingScripts({
  meta,
  gtag,
}: {
  meta: string;
  gtag: string[];
}) {
  const path = usePathname();
  useEffect(() => {
    let disposed = false;
    let generation = 0;
    // Fail-closed: localStorage não é prova de consentimento persistido.
    // Nunca injetar SDKs nem disparar page_view antes de GET /consent=granted.
    const run = async (emitView: boolean) => {
      const current = ++generation;
      pauseTracking();
      if (!hasConsent() || /^\/(acompanhar|newsletter|admin|conta)(\/|$)/.test(path))
        return;
      let authorized = false;
      let serverConfirmed = false;
      try {
        const response = await fetch("/api/analytics/consent", {
          method: "GET",
          credentials: "same-origin",
          cache: "no-store",
        });
        if (response.ok) {
          const body: unknown = await response.json();
          if (body && typeof body === "object" && "granted" in body &&
              typeof (body as { granted?: unknown }).granted === "boolean") {
            serverConfirmed = true;
            authorized = (body as { granted: boolean }).granted;
          }
        }
      } catch {
        // Falha de rede/servidor: não iniciar rastreamento nem apagar preferência.
      }
      if (disposed || current !== generation) return;
      if (!authorized) {
        // Só persistir recusa local quando o servidor confirmar explicitamente
        // expiração, perda ou revogação. Erro de rede permanece fail-closed.
        if (serverConfirmed) setConsent(false);
        return;
      }
      // A escolha pode ter mudado enquanto o GET estava pendente.
      if (!hasConsent()) return;
      const ga4 = gtag.filter((id) => /^G-[A-Z0-9]+$/.test(id)),
        ads = gtag.filter((id) => /^AW-[0-9]+$/.test(id)),
        pixel = /^[0-9]+$/.test(meta) ? meta : "";
      window.dcTracking = { ga4, ads, meta: pixel };
      captureUtm();
      const inject = (id: string, src: string) => {
        if (document.getElementById(id)) return;
        const s = document.createElement("script");
        s.id = id;
        s.async = true;
        s.src = src;
        document.head.appendChild(s);
      };
      window.dataLayer = window.dataLayer || [];
      if (ga4.length || ads.length) {
        window.gtag =
          window.gtag ||
          function () {
            window.dataLayer?.push(arguments);
          };
        window.gtag("consent", "update", {
          analytics_storage: "granted",
          ad_storage: "denied",
          ad_user_data: "denied",
          ad_personalization: "denied",
        });
        window.gtag("js", new Date());
        for (const id of [...ga4, ...ads])
          window.gtag("config", id, {
            send_page_view: false,
            allow_google_signals: false,
            allow_ad_personalization_signals: false,
            page_location: location.origin + path,
            page_referrer: "",
          });
        if (emitView && !privateAnalyticsPath(path))
          window.gtag("event", "page_view", {
            send_to: ga4,
            page_location: location.origin + path,
            page_referrer: "",
          });
        inject(
          "dc-gtag",
          `https://www.googletagmanager.com/gtag/js?id=${[...ga4, ...ads][0]}`,
        );
      }
      if (pixel) {
        if (!window.fbq) {
          const f = Object.assign(
            function (...args: unknown[]) {
              if (f.callMethod) f.callMethod(...args);
              else f.queue.push(args);
            },
            {
              queue: [] as unknown[][],
              callMethod: undefined as
                | undefined
                | ((...args: unknown[]) => void),
              push: undefined as unknown,
              loaded: true,
              version: "2.0",
            },
          );
          f.push = f;
          window.fbq = f;
          (window as unknown as { _fbq: typeof f })._fbq = f;
          window.fbq("set", "autoConfig", false, pixel);
          window.fbq("init", pixel);
          inject("dc-meta", "https://connect.facebook.net/en_US/fbevents.js");
        }
        window.fbq("consent", "grant");
        if (emitView && !privateAnalyticsPath(path)) window.fbq("track", "PageView");
      }
      window.dispatchEvent(new Event("dc-tracking-ready"));
    };

    const onConsentChange = () => { void run(true); };
    const onStorageChange = (event: StorageEvent) => {
      if (event.key === CONSENT_KEY || event.key === null) void run(true);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") void run(false);
    };
    const onFocus = () => { void run(false); };

    void run(true);
    window.addEventListener(CONSENT_EVENT, onConsentChange);
    window.addEventListener("storage", onStorageChange);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      disposed = true;
      generation++;
      window.removeEventListener(CONSENT_EVENT, onConsentChange);
      window.removeEventListener("storage", onStorageChange);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
      pauseTracking();
    };
  }, [meta, gtag, path]);
  return null;
}
