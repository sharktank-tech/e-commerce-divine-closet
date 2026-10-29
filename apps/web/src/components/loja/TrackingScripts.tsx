"use client";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import {
  CONSENT_EVENT,
  captureUtm,
  hasConsent,
  privateAnalyticsPath,
  pauseTracking,
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
    const run = () => {
      window.dcTracking = undefined;
      // Tokens e informações pessoais nunca são enviados em PageView.
      if (
        !hasConsent() ||
        /^\/(acompanhar|newsletter|admin|conta)(\/|$)/.test(path)
      ) {
        pauseTracking();
        return;
      }
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
        if (!privateAnalyticsPath(path))
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
        if (!privateAnalyticsPath(path)) window.fbq("track", "PageView");
      }
      window.dispatchEvent(new Event("dc-tracking-ready"));
    };
    run();
    window.addEventListener(CONSENT_EVENT, run);
    return () => {
      window.removeEventListener(CONSENT_EVENT, run);
      window.dcTracking = undefined;
    };
  }, [meta, gtag, path]);
  return null;
}
