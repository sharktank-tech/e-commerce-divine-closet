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
        disallow: ["/admin", "/api", "/conta", "/checkout", "/carrinho", "/sucesso"],
      },
    ],
    sitemap: `${root}/sitemap.xml`,
  };
}
