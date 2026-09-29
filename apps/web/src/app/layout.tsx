import type { Metadata } from "next";
import "./globals.css";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { CartProvider } from "@/components/loja/CartProvider";
import { prisma } from "@/lib/prisma";
import { ConsentBanner } from "@/components/loja/ConsentBanner";
import { TrackingScripts } from "@/components/loja/TrackingScripts";

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
        {injectOrgSchema()}
        <TrackingScripts meta={pixels.meta} gtag={pixels.gtag} />
      </head>
      <body className="flex min-h-screen flex-col font-sans">
        <CartProvider>
          <Header />
          <main className="flex-1">{children}</main>
          <Footer />
          <ConsentBanner />
        </CartProvider>
      </body>
    </html>
  );
}