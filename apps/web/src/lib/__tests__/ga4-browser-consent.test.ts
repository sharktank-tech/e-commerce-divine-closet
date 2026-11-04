import { describe, expect, it, vi, afterEach } from "vitest";
import { NextRequest } from "next/server";
import {
  GA4_CONSENT_COOKIE,
  newConsentToken,
  readBrowserConsent,
  sameOriginRequest,
} from "../ga4-browser-consent";

afterEach(() => vi.unstubAllEnvs());

describe("GA4 token de consentimento: autenticidade e origem", () => {
  it("aceita somente token assinado pelo servidor", async () => {
    vi.stubEnv("JWT_SECRET", "local-test-secret-at-least-32-characters");
    const issued = await newConsentToken();
    const req = new NextRequest("https://www.divinecloset.com.br/api/analytics/consent", {
      headers: { cookie: `${GA4_CONSENT_COOKIE}=${issued.token}` },
    });
    expect(await readBrowserConsent(req)).toEqual({ tokenId: issued.tokenId, granted: true });
  });
  it("não confia em cookie adulterado", async () => {
    vi.stubEnv("JWT_SECRET", "local-test-secret-at-least-32-characters");
    const issued = await newConsentToken();
    const req = new NextRequest("https://www.divinecloset.com.br/api/analytics/consent", {
      headers: { cookie: `${GA4_CONSENT_COOKIE}=${issued.token.slice(0,-3)}abc` },
    });
    expect(await readBrowserConsent(req)).toBeNull();
  });
  it("nega requests sem Origin e de outras origens", () => {
    const url = "https://www.divinecloset.com.br/api/analytics/consent";
    expect(sameOriginRequest(new NextRequest(url, {
      method: "POST", headers: { host: "www.divinecloset.com.br" },
    }))).toBe(false);
    expect(sameOriginRequest(new NextRequest(url, {
      method: "POST",
      headers: { host: "www.divinecloset.com.br", origin: "https://exemplo-malicioso.com" },
    }))).toBe(false);
  });
  it("autoriza request mesma origem HTTPS", () => {
    expect(sameOriginRequest(new NextRequest("https://www.divinecloset.com.br/api/analytics/consent", {
      method: "POST",
      headers: { host: "www.divinecloset.com.br", origin: "https://www.divinecloset.com.br" },
    }))).toBe(true);
  });
  it("falha quando JWT_SECRET não está configurado", async () => {
    vi.stubEnv("JWT_SECRET", "");
    await expect(newConsentToken()).rejects.toThrow("JWT_SECRET ausente");
  });
  it("falha quando JWT_SECRET é muito curto", async () => {
    vi.stubEnv("JWT_SECRET", "curto");
    await expect(newConsentToken()).rejects.toThrow("JWT_SECRET ausente");
  });
  it("retorna null para token expirado", async () => {
    vi.stubEnv("JWT_SECRET", "local-test-secret-at-least-32-characters");
    // Create a token with past expiration by mocking
    const { SignJWT } = await import("jose");
    const secret = new TextEncoder().encode("local-test-secret-at-least-32-characters");
    const expiredToken = await new SignJWT({ consent: true })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer("divine-closet-analytics-consent")
      .setSubject("00000000-0000-4000-8000-000000000001")
      .setIssuedAt(Math.floor(Date.now() / 1000) - 3600)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 1800)
      .sign(secret);
    const req = new NextRequest("https://www.divinecloset.com.br/api/analytics/consent", {
      headers: { cookie: `dc_ga4_consent=${expiredToken}` },
    });
    expect(await readBrowserConsent(req)).toBeNull();
  });
});
