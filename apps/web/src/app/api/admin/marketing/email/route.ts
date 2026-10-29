import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";
import { requireAuth, forbidden } from "@/lib/auth";
import { sendEmail, emailDriverAtual, EmailNaoAceito } from "@/lib/email";
import { verificarLimite } from "@/lib/rate-limit";

// Disparo de e-mail marketing de teste.
// O driver efetivo é determinado por EMAIL_DRIVER (mock | smtp | resend).
// Esta rota NÃO envia campanhas; apenas um e-mail de teste individual.

const schema = z.object({
  to: z.string().email("Informe um e-mail de destino válido"),
  subject: z.string().min(2, "Assunto deve ter pelo menos 2 caracteres").max(200),
  body: z.string().min(2, "Conteúdo deve ter pelo menos 2 caracteres").max(10000),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireAuth("ADMIN");
    if (!session) return forbidden();

    // Rate limit: 5 requisições por minuto por admin (padrão do projeto)
    const rl = verificarLimite(`marketing-email:${session.sub}`, { janelaMs: 60_000, maximo: 5 });
    if (!rl.permitido) {
      return NextResponse.json(
        { error: "Muitas requisições. Aguarde antes de enviar novamente." },
        { status: 429, headers: { "Retry-After": String(Math.ceil(rl.resetEmMs / 1000)) } }
      );
    }

    const body = await req.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "Dados inválidos" },
        { status: 400 }
      );
    }

    const driver = emailDriverAtual();
    let resultado: { id?: string } | null = null;
    let statusEnvio: "mock" | "accepted" | "failed" = "mock";
    let mensagem: string;

    try {
      resultado = await sendEmail({
        to: parsed.data.to,
        subject: parsed.data.subject,
        text: parsed.data.body,
      });

      if (driver === "mock") {
        statusEnvio = "mock";
        mensagem = "E-mail registrado no log (driver mock) — nenhum envio real.";
      } else {
        statusEnvio = "accepted";
        mensagem = `E-mail aceito pelo provedor (${driver}). O destinatário pode receber em instantes — aceitação não garante entrega.`;
      }
    } catch (err) {
      statusEnvio = "failed";
      if (err instanceof EmailNaoAceito) {
        mensagem = err.message;
      } else {
        mensagem = "Erro ao enviar e-mail. Verifique a configuração do provedor.";
      }
      // Audit failure
      await prisma.auditLog.create({
        data: {
          id: randomUUID(),
          userId: session.sub,
          action: "email_marketing_test",
          entity: "Setting",
          entityId: "emailMarketing",
          meta: {
            to: parsed.data.to,
            subject: parsed.data.subject,
            driver,
            status: "failed",
            error: mensagem.slice(0, 200),
          },
        },
      });
      return NextResponse.json(
        { ok: false, driver, status: "failed", message: mensagem },
        { status: 502 }
      );
    }

    // Audit success
    await prisma.auditLog.create({
      data: {
        id: randomUUID(),
        userId: session.sub,
        action: "email_marketing_test",
        entity: "Setting",
        entityId: "emailMarketing",
        meta: {
          to: parsed.data.to,
          subject: parsed.data.subject,
          driver,
          status: statusEnvio,
          providerId: resultado?.id || null,
        },
      },
    });

    return NextResponse.json({
      ok: true,
      driver,
      status: statusEnvio,
      message: mensagem,
      providerId: resultado?.id || null,
    });
  } catch (err) {
    console.error("[admin:marketing:email]", err);
    return NextResponse.json({ error: "Erro ao disparar e-mail" }, { status: 500 });
  }
}
