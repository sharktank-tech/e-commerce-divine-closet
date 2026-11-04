import { SignJWT, jwtVerify } from "jose";
import { randomUUID } from "crypto";
import type { NextRequest } from "next/server";

export const GA4_CONSENT_COOKIE = "dc_ga4_consent";
const secret = new TextEncoder().encode(process.env.JWT_SECRET || "dev-secret-troque-em-producao");
const issuer = "divine-closet-analytics-consent";

export type BrowserConsent = { tokenId: string; granted: true };

export async function newConsentToken(): Promise<{ token: string; tokenId: string }> {
  const tokenId = randomUUID();
  const token = await new SignJWT({ consent: true })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(issuer)
    .setSubject(tokenId)
    .setIssuedAt()
    .setExpirationTime("90d")
    .sign(secret);
  return { token, tokenId };
}

export async function readBrowserConsent(req: NextRequest): Promise<BrowserConsent | null> {
  const raw = req.cookies.get(GA4_CONSENT_COOKIE)?.value;
  if (!raw) return null;
  try {
    const { payload } = await jwtVerify(raw, secret, { issuer });
    if (payload.consent !== true || typeof payload.sub !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(payload.sub)) return null;
    return { tokenId: payload.sub, granted: true };
  } catch {
    return null;
  }
}

/** Protege mudanças de consentimento contra POSTs cross-site. */
export function sameOriginRequest(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  try {
    const host = req.headers.get("host");
    const url = new URL(origin);
    return Boolean(host && url.host === host && (url.protocol === "https:" || process.env.NODE_ENV !== "production"));
  } catch { return false; }
}
