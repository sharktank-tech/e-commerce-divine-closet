import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const root = (
    process.env.NEXT_PUBLIC_APP_URL || "https://www.divinecloset.com.br"
  ).replace(/\/$/, "");
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // /acompanhar/[token] é link privado (segredo no path) — fora do
        // índice, junto das rotas internas.
        disallow: ["/admin", "/api", "/conta", "/checkout", "/carrinho", "/sucesso", "/acompanhar"],
      },
    ],
    sitemap: `${root}/sitemap.xml`,
  };
}
