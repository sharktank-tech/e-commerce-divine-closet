import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import {
  GA4_CONSENT_COOKIE,
  newConsentToken,
  readBrowserConsent,
  sameOriginRequest,
} from "../ga4-browser-consent";

describe("GA4 token de consentimento: autenticidade e origem", () => {
  it("aceita somente token assinado pelo servidor", async () => {
    const issued = await newConsentToken();
    const req = new NextRequest("https://www.divinecloset.com.br/api/analytics/consent", {
      headers: { cookie: `${GA4_CONSENT_COOKIE}=${issued.token}` },
    });
    expect(await readBrowserConsent(req)).toEqual({ tokenId: issued.tokenId, granted: true });
  });
  it("não confia em cookie adulterado", async () => {
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
});
