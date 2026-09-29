import type React from "react";
import { MetadataRoute } from "next";

export async function generateSitemap(): Promise<MetadataRoute.Sitemap> {
  return [];
}

export function injectSchemaLD(ld: Record<string, unknown>): React.ReactNode {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(ld, null, 2) }}
    />
  );
}