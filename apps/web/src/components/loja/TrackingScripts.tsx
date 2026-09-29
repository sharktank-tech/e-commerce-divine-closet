"use client";

import { useEffect, useState } from "react";
import Script from "next/script";
import { hasConsent } from "@/lib/analytics";

type Props = { meta: string; gtag: string[] };

// Só injeta rastreamento com consentimento explícito (LGPD).
// Sem IDs configurados, nada é renderizado.
export function TrackingScripts({ meta, gtag }: Props) {
  const [ok, setOk] = useState(false);

  useEffect(() => {
    setOk(hasConsent());
  }, []);

  if (!ok) return null;
  if (!meta && gtag.length === 0) return null;

  return (
    <>
      {meta && (
        <>
          <Script
            id="meta-pixel"
            strategy="afterInteractive"
            dangerouslySetInnerHTML={{
              __html: `!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${meta}');fbq('track','PageView');`,
            }}
          />
          <noscript>
            <img
              height="1"
              width="1"
              style={{ display: "none" }}
              src={`https://www.facebook.com/tr?id=${meta}&ev=PageView&noscript=1`}
              alt=""
              loading="lazy"
            />
          </noscript>
        </>
      )}
      {gtag.length > 0 && (
        <>
          <Script
            id="gtag-src"
            strategy="afterInteractive"
            src={`https://www.googletagmanager.com/gtag/js?id=${gtag[0]}`}
          />
          <Script
            id="gtag-cfg"
            strategy="afterInteractive"
            dangerouslySetInnerHTML={{
              __html: `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());${gtag
                .map((id) => `gtag('config','${id}');`)
                .join("")}`,
            }}
          />
        </>
      )}
    </>
  );
}
