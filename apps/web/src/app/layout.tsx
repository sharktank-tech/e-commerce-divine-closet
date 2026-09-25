import type { Metadata } from "next";
import "./globals.css";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { CartProvider } from "@/components/loja/CartProvider";
import { prisma } from "@/lib/prisma";

export const metadata: Metadata = {
  title: {
    default: "Divine Closet — Moda que eleva o seu dia",
    template: "%s | Divine Closet",
  },
  description:
    "Loja de moda online com vestidos, conjuntos e acessórios selecionados. Entrega para todo o Brasil.",
};

// Revalida configurações (pixels) periodicamente sem quebrar páginas estáticas.
export const revalidate = 300;

// Pixels de rastreamento (seção 4.6) — IDs salvos no painel (/admin/configuracoes).
// Enquanto vazios, nenhum script é injetado. // TODO-CLIENTE: contas Meta/Google.
async function getPixelIds(): Promise<{ meta: string; gtag: string[] }> {
  try {
    const row = await prisma.setting.findUnique({ where: { key: "pixels" } });
    if (!row) return { meta: "", gtag: [] };
    const p = JSON.parse(row.value) as {
      metaPixelId?: string;
      googleAdsId?: string;
      ga4Id?: string;
    };
    const gtag = [p.ga4Id, p.googleAdsId].filter((x): x is string => !!x && x.trim() !== "");
    return { meta: (p.metaPixelId || "").trim(), gtag };
  } catch {
    return { meta: "", gtag: [] };
  }
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pixels = await getPixelIds();

  return (
    <html lang="pt-BR">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Playfair+Display:wght@600;700;800&display=swap"
          rel="stylesheet"
        />
        {pixels.meta && (
          <>
            <script
              dangerouslySetInnerHTML={{
                __html: `!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${pixels.meta}');fbq('track','PageView');`,
              }}
            />
            <noscript>
              <img
                height="1"
                width="1"
                style={{ display: "none" }}
                src={`https://www.facebook.com/tr?id=${pixels.meta}&ev=PageView&noscript=1`}
                alt=""
              />
            </noscript>
          </>
        )}
        {pixels.gtag.length > 0 && (
          <>
            <script
              async
              src={`https://www.googletagmanager.com/gtag/js?id=${pixels.gtag[0]}`}
            />
            <script
              dangerouslySetInnerHTML={{
                __html: `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());${pixels.gtag
                  .map((id) => `gtag('config','${id}');`)
                  .join("")}`,
              }}
            />
          </>
        )}
      </head>
      <body className="flex min-h-screen flex-col font-sans">
        <CartProvider>
          <Header />
          <main className="flex-1">{children}</main>
          <Footer />
        </CartProvider>
      </body>
    </html>
  );
}
