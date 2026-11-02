import type { Metadata } from "next";
import "./globals.css";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { CartProvider } from "@/components/loja/CartProvider";
import { prisma } from "@/lib/prisma";
import { ConsentBanner } from "@/components/loja/ConsentBanner";
import { TrackingScripts } from "@/components/loja/TrackingScripts";
import { WhatsAppButton } from "@/components/loja/WhatsAppButton";

export const metadata: Metadata = {
  metadataBase: new URL(
    (process.env.NEXT_PUBLIC_APP_URL || "https://www.divinecloset.com.br").replace(/\/$/, "")
  ),
  title: {
    default: "Divine Closet | Moda feminina: vestidos, conjuntos e mais",
    template: "%s | Divine Closet",
  },
  description:
    "Moda feminina online: vestidos, conjuntos, blusas e mais. Peças selecionadas com entrega para todo o Brasil e troca fácil em 30 dias.",
  openGraph: {
    type: "website",
    locale: "pt_BR",
    siteName: "Divine Closet",
  },
  twitter: {
    card: "summary_large_image",
  },
  icons: {
    icon: [{ url: "/favicon.png?v=2", sizes: "64x64", type: "image/png" }],
    apple: [{ url: "/apple-touch-icon.png?v=2", sizes: "180x180", type: "image/png" }],
  },
};

function injectOrgSchema(): React.ReactNode {
  const ld = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "Divine Closet",
    url: "https://www.divinecloset.com.br",
    description:
      "Loja de moda feminina online: vestidos, conjuntos, blusas e mais. Peças selecionadas com entrega para todo o Brasil e troca fácil em 30 dias.",
    logo: "/favicon.png?v=2",
  });
  // Script SSR puro (não next/script): rastreadores leem sem executar JS.
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ld }} />;
}

// Revalida configurações (pixels) periodicamente sem quebrar páginas estáticas.
export const revalidate = 300;

// A medição GA4 da loja é conhecida e não depende de leitura dinâmica do banco.
// TrackingScripts só carrega o Google tag após consentimento; não duplicar scripts.
const STORE_GA4_ID = "G-6WPDJX4KBB";

async function getPixelIds(): Promise<{ meta: string; gtag: string[] }> {
  try {
    const row = await prisma.setting.findUnique({ where: { key: "pixels" } });
    if (!row) return { meta: "", gtag: [STORE_GA4_ID] };
    const p = JSON.parse(row.value) as {
      metaPixelId?: string;
      googleAdsId?: string;
      ga4Id?: string;
    };
    const gtag = Array.from(
      new Set(
        [STORE_GA4_ID, p.ga4Id, p.googleAdsId]
          .filter((x): x is string => typeof x === "string" && x.trim() !== "")
          .map((id) => id.trim()),
      ),
    );
    return { meta: (p.metaPixelId || "").trim(), gtag };
  } catch {
    // Uma falha na leitura de configurações não deve desativar o GA4 da loja.
    return { meta: "", gtag: [STORE_GA4_ID] };
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
        {injectOrgSchema()}
      </head>
      <body className="flex min-h-screen flex-col font-sans">
        <TrackingScripts meta={pixels.meta} gtag={pixels.gtag} />
        <CartProvider>
          <Header />
          <main className="flex-1">{children}</main>
          <Footer />
          <ConsentBanner />
          <WhatsAppButton />
        </CartProvider>
      </body>
    </html>
  );
}