/**
 * Backfill do e-mail REFUNDED do pedido DC-20261017-7653 (estorno real de
 * 17/10 executado ANTES da correção do fluxo: o pedido ficou REFUNDED, mas
 * o estorno nunca chamava o envio de e-mail — ver
 * EMAIL-ESTORNO-RETENTATIVA.md).
 *
 * PREPARADO, NÃO EXECUTAR sem autorização explícita (a rodada de validação
 * proíbe envio real de e-mails e alterações novas em produção).
 *
 * Uso:
 *   # dry-run (padrão) — só LÊ e imprime resumo sanitizado, NÃO grava nada:
 *   npx tsx --tsconfig apps/web/tsconfig.json scripts/backfill-estorno-email-7653.ts
 *
 *   # enfileira a linha PENDING no outbox (única gravação). O ENVIO acontece
 *   # DEPOIS do deploy, pelo cron (/api/cron/emails ou as janelas de 09h/18h)
 *   # — este script NUNCA envia e-mail:
 *   npx tsx --tsconfig apps/web/tsconfig.json scripts/backfill-estorno-email-7653.ts --aplicar
 *
 * Garantias:
 * - payload renderizado pelo MESMO código de produção
 *   (montarEmailStatusPedido → template REFUNDED com link de acompanhamento);
 * - idempotente: dedupeKey `status:{orderId}:REFUNDED` única no outbox
 *   (segunda execução → P2002, reporta a linha existente);
 * - só enfileira se o pedido realmente está REFUNDED (status e pagamento);
 * - sem envio aqui: o script só grava PENDING. O dreno (cron) é quem tenta
 *   enviar e só marca SENT quando `sendEmail` resolve com um driver real
 *   (smtp/resend). Com `EMAIL_DRIVER=mock` o outbox NÃO marca SENT (a linha
 *   fica PENDING até um driver real entregar). Fila vazia não comprova
 *   transporte ativo: isso depende de `EMAIL_DRIVER`+credenciais, não do
 *   outbox.
 *
 * Obs.: DC-20261017-7653 é de cliente LOGADO (userId) → o link de
 * acompanhamento é estático (/conta?tab=pedidos) e a montagem NÃO cria token
 * (dry-run é 100% leitura). Para pedidos GUEST a montagem criaria token
 * (escrita) — fora do escopo deste pedido.
 */
import { readFileSync } from "fs";
import { join } from "path";

const NUMERO_PEDIDO = "DC-20261017-7653";

function loadEnv() {
  try {
    const raw = readFileSync(join(process.cwd(), ".env"), "utf8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^([A-Z_]+)="(.*)"$/) || line.match(/^([A-Z_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  } catch {
    // sem .env — usa o ambiente do shell
  }
}

function mascararEmail(email: string): string {
  const [local, dominio] = email.split("@");
  if (!dominio) return "***";
  return `${local.slice(0, 1)}***@${dominio}`;
}

async function main() {
  loadEnv();
  const aplicar = process.argv.includes("--aplicar");

  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL ausente (confira o .env ou o ambiente).");
  }

  // Import dinâmico APÓS loadEnv: o cliente Prisma/@/lib precisa da env pronta.
  const { PrismaClient } = await import("@prisma/client");
  const { montarEmailStatusPedido } = await import(
    "../apps/web/src/lib/pedidos/notificar-status"
  );

  const prisma = new PrismaClient();
  try {
    const pedido = (await prisma.order.findUnique({
      where: { number: NUMERO_PEDIDO },
      select: {
        id: true,
        number: true,
        status: true,
        paymentStatus: true,
        userId: true,
        guestEmail: true,
      },
    })) as {
      id: string;
      number: string;
      status: string;
      paymentStatus: string;
      userId: string | null;
      guestEmail: string | null;
    } | null;

    if (!pedido) {
      throw new Error(`Pedido ${NUMERO_PEDIDO} não encontrado.`);
    }
    if (pedido.status !== "REFUNDED" || pedido.paymentStatus !== "REFUNDED") {
      throw new Error(
        `Pedido ${NUMERO_PEDIDO} não está REFUNDED (status=${pedido.status}, ` +
          `paymentStatus=${pedido.paymentStatus}) — backfill só para estorno real.`
      );
    }

    const mail = await montarEmailStatusPedido({
      orderId: pedido.id,
      status: "REFUNDED",
    });
    if (!mail) {
      throw new Error("Sem destinatário — nada a enfileirar.");
    }

    const dedupeKey = `status:${pedido.id}:REFUNDED`;
    console.log("────────────────────────────────────────");
    console.log("[backfill 7653] resumo sanitizado:");
    console.log(`  pedido:     ${pedido.number} (${pedido.id})`);
    console.log(`  origem:     ${pedido.userId ? "cliente logado" : "guest"}`);
    console.log(`  destinat.:  ${mascararEmail(mail.to)}`);
    console.log(`  assunto:    ${mail.subject}`);
    console.log(
      `  payload:    text=${mail.text.length} chars, html=${mail.html?.length ?? 0} chars`
    );
    console.log(`  dedupeKey:  ${dedupeKey}`);
    console.log("────────────────────────────────────────");

    if (!aplicar) {
      console.log(
        "[dry-run] NENHUMA gravação. Para enfileirar, reexecute com --aplicar " +
          "(após autorização; o envio só ocorre no cron pós-deploy)."
      );
      return;
    }

    try {
      const row = await prisma.emailOutbox.create({
        data: {
          dedupeKey,
          kind: "status_pedido",
          orderId: pedido.id,
          recipient: mail.to,
          subject: mail.subject,
          text: mail.text,
          html: mail.html ?? null,
          status: "PENDING",
          attempt: 0,
          nextAttemptAt: new Date(),
        },
      });
      console.log(`[backfill 7653] enfileirado: linha ${row.id} (PENDING).`);
    } catch (err) {
      if ((err as { code?: string })?.code === "P2002") {
        const existente = await prisma.emailOutbox.findUnique({
          where: { dedupeKey },
        });
        console.log(
          `[backfill 7653] já enfileirado: linha ${existente?.id ?? "?"} — nada a fazer.`
        );
        return;
      }
      throw err;
    }

    console.log(
      "Próximo passo: após o deploy da migration, o cron /api/cron/emails " +
        "(18h UTC, janelas de 09h/18h) drena e envia — ou dispare manualmente: " +
        "curl -H \"Authorization: Bearer $CRON_SECRET\" https://<app>/api/cron/emails"
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("[backfill 7653] ERRO:", err instanceof Error ? err.message : err);
  process.exit(1);
});
