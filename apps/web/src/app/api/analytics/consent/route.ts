import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { Prisma } from "@prisma/client";
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

  // Recusa não exige cookie de GA4: com sessão CLIENT válida, a revogação
  // alcança também os pedidos já associados à conta em outros dispositivos.
  // Não revoga pedidos de convidados sem prova de posse.
  const session = await getSession(req);
  const accountId = session?.role === "CLIENT" ? session.sub : null;
  if (previous || accountId) {
    await prisma.$transaction(async (tx) => {
      const identities = await tx.analyticsOrderIdentity.findMany({
        where: {
          OR: [
            ...(previous ? [{ consentTokenId: previous.tokenId }] : []),
            ...(accountId ? [{ order: { userId: accountId } }] : []),
          ],
        },
        select: { orderId: true, consentTokenId: true },
      });
      const orderIds = [...new Set(identities.map((entry) => entry.orderId))];
      const tokenIds = [...new Set([
        ...(previous ? [previous.tokenId] : []),
        ...identities.map((entry) => entry.consentTokenId).filter((id): id is string => Boolean(id)),
      ])];
      const revokedAt = new Date();
      if (tokenIds.length) {
        await tx.analyticsBrowserConsent.updateMany({
          where: { id: { in: tokenIds }, state: { not: "REVOKED" } },
          data: { state: "REVOKED", revokedAt },
        });
      }
      if (orderIds.length) {
        // Bloqueia as linhas da outbox até finalizar a revogação, evitando
        // interleaving entre PENDING/PROCESSING e finalização do worker.
        // Não impede egress que já tenha começado: transporte continua hard-off.
        await tx.$queryRaw`
          SELECT "id" FROM "AnalyticsEvent"
          WHERE "orderId" IN (${Prisma.join(orderIds.map((id) => Prisma.sql`${id}::uuid`))})
            AND "status" IN ('PENDING', 'FAILED', 'PROCESSING')
          ORDER BY "id" FOR UPDATE
        `;
        await tx.analyticsOrderIdentity.updateMany({
          where: { orderId: { in: orderIds } },
          data: { consentState: "REVOKED", clientId: null, revokedAt },
        });
        // PROCESSING não é presumido não entregue; transporte continua hard-off.
        await tx.analyticsEvent.updateMany({
          where: { orderId: { in: orderIds }, status: { in: ["PENDING", "FAILED"] } },
          data: { status: "SKIPPED", leaseUntil: null, lastError: "consent_revoked" },
        });
        // PROCESSING pode já ter sido enviado: quarentena FAILED, sem retry.
        // Não declarar SKIPPED para um resultado externo incerto.
        await tx.analyticsEvent.updateMany({
          where: { orderId: { in: orderIds }, status: "PROCESSING" },
          data: { status: "FAILED", leaseUntil: null, lastError: "consent_revoked_inflight_uncertain" },
        });
      }
      await tx.auditLog.create({
        data: {
          action: "ga4_consent_revoked",
          entity: accountId ? "AccountAnalyticsConsent" : "AnalyticsBrowserConsent",
          entityId: accountId ?? previous?.tokenId,
          meta: { revoked: true, affectedOrders: orderIds.length, source: accountId ? "account_and_browser" : "browser" },
        },
      });
    });
  }
  const resp = NextResponse.json({ ok: true });
  resp.cookies.delete(GA4_CONSENT_COOKIE);
  return resp;
}
