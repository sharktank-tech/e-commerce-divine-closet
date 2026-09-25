import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAuth, forbidden } from "@/lib/auth";
import { sendEmail } from "@/lib/email";

// Disparo de e-mail marketing — estrutura pronta (seção 4.6).
// Em dev o driver é mock (log no console) até o provedor real ser definido.
// TODO-CLIENTE: provedor de e-mail marketing (Mailchimp/SES/etc).

const schema = z.object({
  to: z.string().email("Informe um e-mail de destino"),
  subject: z.string().min(2),
  body: z.string().min(2),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireAuth("ADMIN");
    if (!session) return forbidden();

    const body = await req.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "Dados inválidos" },
        { status: 400 }
      );
    }

    await sendEmail({
      to: parsed.data.to,
      subject: parsed.data.subject,
      text: parsed.data.body,
    });

    await prisma.auditLog.create({
      data: {
        userId: session.sub,
        action: "email_marketing_test",
        entity: "Setting",
        entityId: "emailMarketing",
        meta: { to: parsed.data.to, subject: parsed.data.subject },
      },
    });

    return NextResponse.json({
      ok: true,
      message: "E-mail registrado no log (driver mock) — nenhum envio real.",
    });
  } catch (err) {
    console.error("[admin:marketing:email]", err);
    return NextResponse.json({ error: "Erro ao disparar e-mail" }, { status: 500 });
  }
}
