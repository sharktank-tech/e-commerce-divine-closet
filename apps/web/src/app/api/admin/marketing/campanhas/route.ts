import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAuth, forbidden } from "@/lib/auth";
import { consumirRateLimit } from "@/lib/rate-limit";
import {
  cancelCampaign,
  queueCampaign,
  drainMarketing,
  campaignRevision,
  eligibleSubscriber,
} from "@/lib/marketing/campaigns";
const content = z.object({
  subject: z.string().trim().min(2).max(200),
  body: z.string().trim().min(2).max(10000),
  source: z.enum(["footer", "newsletter"]).nullable().default(null),
});
const operation = z.discriminatedUnion("action", [
  content.extend({ action: z.literal("create") }),
  content.extend({ action: z.literal("edit"), id: z.string().uuid() }),
  z.object({
    action: z.literal("queue"),
    id: z.string().uuid(),
    confirm: z.literal(true),
    expectedRecipients: z.number().int().min(0).max(1000),
    expectedRevision: z.string().regex(/^[a-f0-9]{64}$/),
  }),
  z.object({ action: z.literal("cancel"), id: z.string().uuid() }),
  z.object({ action: z.literal("drain"), confirm: z.literal(true) }),
]);
export async function GET() {
  if (!(await requireAuth("ADMIN"))) return forbidden();
  const campaigns = await prisma.marketingCampaign.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { messages: { select: { status: true } } },
  });
  const eligible = await prisma.newsletterSubscriber.groupBy({
    by: ["consentSource"],
    where: eligibleSubscriber,
    _count: true,
  });
  return NextResponse.json(
    {
      campaigns: campaigns.map((c) => ({
        ...c,
        revision: campaignRevision(c),
        messages: undefined,
        counts: c.messages.reduce<Record<string, number>>((a, m) => {
          a[m.status] = (a[m.status] || 0) + 1;
          return a;
        }, {}),
      })),
      eligible: eligible.map((e) => ({
        source: e.consentSource,
        count: e._count,
      })),
      driver: process.env.EMAIL_DRIVER || "mock",
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
export async function POST(req: NextRequest) {
  const session = await requireAuth("ADMIN");
  if (!session) return forbidden();
  if (
    !(
      await consumirRateLimit(`marketing:campaign:${session.sub}`, {
        limite: 20,
        janelaMin: 1,
      })
    ).permitido
  )
    return NextResponse.json(
      { error: "Aguarde antes de tentar novamente." },
      { status: 429 },
    );
  const parsed = operation.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "Operação inválida." }, { status: 400 });
  const d = parsed.data;
  try {
    if (d.action === "create")
      return NextResponse.json(
        await prisma.marketingCampaign.create({
          data: {
            subject: d.subject,
            body: d.body,
            source: d.source,
            createdBy: session.sub,
          },
        }),
        { status: 201 },
      );
    if (d.action === "edit") {
      const result = await prisma.marketingCampaign.updateMany({
        where: { id: d.id, status: "DRAFT" },
        data: { subject: d.subject, body: d.body, source: d.source },
      });
      return NextResponse.json(
        { ok: result.count === 1 },
        { status: result.count ? 200 : 409 },
      );
    }
    if (d.action === "queue")
      return NextResponse.json(
        await queueCampaign(
          d.id,
          session.sub,
          d.expectedRecipients,
          d.expectedRevision,
        ),
      );
    if (d.action === "cancel")
      return NextResponse.json(await cancelCampaign(d.id, session.sub));
    return NextResponse.json(await drainMarketing());
  } catch {
    return NextResponse.json(
      {
        error:
          "Não foi possível concluir. Atualize a prévia e confira o estado da campanha.",
      },
      { status: 409 },
    );
  }
}
