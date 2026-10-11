import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [{ protocol: "http", hostname: "**" }],
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "5mb",
    },
  },
  // Sem CSP por enquanto (scripts inline do Next + sdk.mercadopago.com
  // quebrariam com política restritiva — avaliar em item próprio).
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
