import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  GA4_CONSENT_COOKIE,
  newConsentToken,
  readBrowserConsent,
  sameOriginRequest,
} from "@/lib/ga4-browser-consent";

/** Consultar consentimento NÃO renova nem recria aceite. */
export async function GET(req: NextRequest) {
  const token = await readBrowserConsent(req);
  if (!token) return NextResponse.json({ granted: false }, { headers: { "Cache-Control": "no-store" } });
  const existing = await prisma.analyticsBrowserConsent.findUnique({
    where: { id: token.tokenId },
    select: { state: true, expiresAt: true, revokedAt: true },
  });
  const granted = existing?.state === "GRANTED" &&
    !existing.revokedAt && existing.expiresAt > new Date();
  return NextResponse.json({ granted }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  if (!sameOriginRequest(req)) return NextResponse.json({ error: "Origem inválida" }, { status: 403 });
  if (process.env.NODE_ENV === "production" && (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32))
    return NextResponse.json({ error: "Consentimento indisponível" }, { status: 503 });

  let input: unknown;
  try { input = await req.json(); } catch { return NextResponse.json({ error: "JSON inválido" }, { status: 400 }); }
  if (!input || typeof input !== "object" || !("granted" in input) ||
      typeof (input as { granted?: unknown }).granted !== "boolean")
    return NextResponse.json({ error: "Consentimento inválido" }, { status: 400 });
  const granted = (input as { granted: boolean }).granted;
  const previous = await readBrowserConsent(req);

  if (granted) {
    // Renovação do aceite usa o mesmo token; token revogado NÃO pode reativar.
    if (previous) {
      const existing = await prisma.analyticsBrowserConsent.findUnique({ where: { id: previous.tokenId } });
      if (existing?.state === "GRANTED" && existing.expiresAt > new Date())
        return NextResponse.json({ ok: true });
    }
    const fresh = await newConsentToken();
    await prisma.analyticsBrowserConsent.create({
      data: { id: fresh.tokenId, state: "GRANTED", grantedAt: new Date(),
        expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000) },
    });
    // Audit: registrar concessão (sem dados pessoais)
    await prisma.auditLog.create({
      data: {
        action: "ga4_consent_granted",
        entity: "AnalyticsBrowserConsent",
        entityId: fresh.tokenId,
        meta: { granted: true, source: "user_action" },
      },
    });
    const resp = NextResponse.json({ ok: true });
    resp.cookies.set(GA4_CONSENT_COOKIE, fresh.token, {
      httpOnly: true, secure: process.env.NODE_ENV === "production",
      sameSite: "strict", path: "/", maxAge: 90 * 24 * 60 * 60,
    });
    return resp;
  }

  if (previous) {
    await prisma.$transaction(async (tx) => {
      await tx.analyticsBrowserConsent.updateMany({
        where: { id: previous.tokenId },
        data: { state: "REVOKED", revokedAt: new Date() },
      });
      const identities = await tx.analyticsOrderIdentity.findMany({
        where: { consentTokenId: previous.tokenId },
        select: { orderId: true },
      });
      await tx.analyticsOrderIdentity.updateMany({
        where: { consentTokenId: previous.tokenId },
        data: { consentState: "REVOKED", clientId: null, revokedAt: new Date() },
      });
      if (identities.length) {
        await tx.analyticsEvent.updateMany({
          where: { orderId: { in: identities.map((i) => i.orderId) }, status: { in: ["PENDING", "FAILED"] } },
          data: { status: "SKIPPED", lastError: "consent_revoked" },
        });
      }
      // Audit: registrar revogação (sem dados pessoais)
      await tx.auditLog.create({
        data: {
          action: "ga4_consent_revoked",
          entity: "AnalyticsBrowserConsent",
          entityId: previous.tokenId,
          meta: { revoked: true, affectedOrders: identities.length },
        },
      });
    });
  }
  const resp = NextResponse.json({ ok: true });
  resp.cookies.delete(GA4_CONSENT_COOKIE);
  return resp;
}
