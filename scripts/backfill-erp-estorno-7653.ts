/**
 * Backfill do evento ERP `pedido_estornado` do pedido DC-20261017-7653.
 *
 * O estorno real de 17/10 foi concluído ANTES da correção de persistência
 * (na época, enfileirarEvento descartava o evento quando faltava
 * ERP_WEBHOOK_URL/SECRET — ver ERP-EVENTOS-PERSISTENTES.md): o pedido está
 * REFUNDED, mas o histórico ERP nunca registrou a ocorrência.
 *
 * PREPARADO, NÃO EXECUTAR sem autorização explícita. Observações:
 * - exige a migration 20261017220000_erp_event_business_key em produção
 *   (coluna businessKey) — falha com erro de coluna se rodar antes;
 * - NÃO entrega nada (sem fetch): o cron dreno (/api/cron/carrinho-abandonado)
 *   só entrega quando houver ERP_WEBHOOK_URL+SECRET configurados; sem config a
 *   linha fica guardada. Fila com PENDING ≠ transporte ativo; fila vazia ≠
 *   transporte desativado — o estado do transporte é `ERP_WEBHOOK_URL/SECRET`,
 *   e ambos são ilegíveis daqui (painel Vercel).
 *
 * Uso:
 *   # dry-run (padrão) — só LÊ e imprime resumo, NÃO grava nada:
 *   npx tsx --tsconfig apps/web/tsconfig.json scripts/backfill-erp-estorno-7653.ts
 *
 *   # grava a linha PENDING (única escrita; idempotente via businessKey):
 *   npx tsx --tsconfig apps/web/tsconfig.json scripts/backfill-erp-estorno-7653.ts --aplicar
 *
 * Garantias:
 * - payload = MESMO formato do produto: {numero, total};
 * - businessKey única `pedido_estornado:{orderId}` — segunda execução
 *   (ou corrida com o fluxo normal) vira P2002 e reporta a linha existente;
 * - createdAt = Refund.resolvedAt real → envelope ocorrido_em = horário
 *   do estorno no provedor, não o horário do backfill;
 * - linha nasce PENDING/attempt=0 → dreno entrega depois da ativação do ERP;
 * - nunca chama entregarEvento aqui.
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

async function main() {
  loadEnv();
  const aplicar = process.argv.includes("--aplicar");

  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL ausente (confira o .env ou o ambiente).");
  }

  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  try {
    const pedido = (await prisma.order.findUnique({
      where: { number: NUMERO_PEDIDO },
      select: {
        id: true,
        number: true,
        status: true,
        paymentStatus: true,
        total: true,
      },
    })) as {
      id: string;
      number: string;
      status: string;
      paymentStatus: string;
      total: unknown;
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

    const refund = (await prisma.refund.findUnique({
      where: { orderId: pedido.id },
      select: { status: true, mpRefundId: true, resolvedAt: true },
    })) as {
      status: string;
      mpRefundId: string | null;
      resolvedAt: Date | null;
    } | null;

    if (!refund || refund.status !== "APPROVED") {
      throw new Error(
        `Refund do ${NUMERO_PEDIDO} não está APPROVED ` +
          `(status=${refund?.status ?? "ausente"}) — nada a backfilar.`
      );
    }

    const businessKey = `pedido_estornado:${pedido.id}`;
    let existente: { id: string; status: string } | null = null;
    let migracaoPendente = false;
    try {
      existente = (await prisma.erpEvent.findUnique({
        where: { businessKey },
        select: { id: true, status: true },
      })) as { id: string; status: string } | null;
    } catch (err) {
      if (
        err instanceof Error &&
        (err as { code?: string }).code === "P2022"
      ) {
        // coluna businessKey ainda não existe no alvo → migration pendente
        migracaoPendente = true;
      } else if (
        err instanceof Error &&
        err.message.includes("businessKey")
      ) {
        migracaoPendente = true;
      } else {
        throw err;
      }
    }
    const ocorridoEm = refund.resolvedAt ?? new Date();
    const total = Number(pedido.total);

    console.log("────────────────────────────────────────");
    console.log("[backfill erp 7653] resumo:");
    console.log(`  pedido:      ${pedido.number} (${pedido.id})`);
    console.log(`  refund:      mpRefundId=${refund.mpRefundId ?? "?"} (${refund.status})`);
    console.log(`  tipo:        pedido_estornado`);
    console.log(`  businessKey: ${businessKey}`);
    console.log(`  payload:     {numero: ${pedido.number}, total: ${total}}`);
    console.log(`  ocorrido_em: ${ocorridoEm.toISOString()} (= resolvedAt real)`);
    console.log(
      migracaoPendente
        ? "  migração:    PENDENTE (20261017220000_erp_event_business_key não aplicada no alvo)"
        : existente
          ? `  já existe:   linha ${existente.id} (status=${existente.status})`
          : "  já existe:   não"
    );
    console.log("────────────────────────────────────────");

    if (migracaoPendente) {
      if (aplicar) {
        throw new Error(
          "Coluna businessKey inexistente no alvo — aplie antes a migration " +
            "20261017220000_erp_event_business_key (deploy do PR ERP)."
        );
      }
      console.log(
        "[dry-run] leitura ok, mas a migration businessKey ainda não foi " +
          "aplicada no alvo: --aplicar só funciona após o deploy. NENHUMA gravação."
      );
      return;
    }

    if (existente) {
      console.log(
        "[backfill erp 7653] evento já registrado — nada a fazer (businessKey única)."
      );
      return;
    }

    if (!aplicar) {
      console.log(
        "[dry-run] NENHUMA gravação. Para criar a linha, reexecute com --aplicar " +
          "(após autorização e após a migration businessKey em produção)."
      );
      return;
    }

    try {
      const row = await prisma.erpEvent.create({
        data: {
          businessKey,
          tipo: "pedido_estornado",
          payload: { numero: pedido.number, total },
          status: "PENDING",
          attempt: 0,
          nextAttemptAt: new Date(),
          createdAt: ocorridoEm,
        },
      });
      console.log(
        `[backfill erp 7653] criado: linha ${row.id} (PENDING, occurred_at=` +
          `${ocorridoEm.toISOString()}). NÃO entregue aqui.`
      );
    } catch (err) {
      if ((err as { code?: string })?.code === "P2002") {
        const dup = await prisma.erpEvent.findUnique({ where: { businessKey } });
        console.log(
          `[backfill erp 7653] corrida detectada: linha ${dup?.id ?? "?"} já existe.`
        );
        return;
      }
      if ((err as { code?: string })?.code === "P2022") {
        throw new Error(
          "Coluna businessKey inexistente — aplie antes a migration " +
            "20261017220000_erp_event_business_key (deploy do PR ERP)."
        );
      }
      throw err;
    }

    console.log(
      "Entrega (NÃO feita aqui): configurar ERP_WEBHOOK_URL/SECRET em produção " +
        "e deixar o dreno rodar — cron /api/cron/carrinho-abandonado " +
        "(12:00 UTC = 09h local) — ou acionamento manual via " +
        "POST /api/admin/erp?acao=reprocessar (sessão admin). Sem URL+secret " +
        "a linha fica guardada: fila com linhas PENDING não significa " +
        "transporte ativo, e fila vazia não significa transporte desativado."
    );
    console.log(
      "Atenção: o fallback automático (NEXT_PUBLIC_APP_URL + /erp/hooks) foi " +
        "REMOVIDO de config() — ERP_WEBHOOK_URL precisa ser uma URL absoluta " +
        "válida apontando para um receptor real antes de qualquer entrega " +
        "(sem URL válida ou sem secret, config() = null e nada é enviado; a " +
        "linha fica guardada)."
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(
    "[backfill erp 7653] ERRO:",
    err instanceof Error ? err.message : err
  );
  process.exit(1);
});
