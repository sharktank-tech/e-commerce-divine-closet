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
 *   # DEPOIS, na próxima janela de dreno — este script NUNCA envia e-mail:
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

/**
 * Evidência SOMENTE-LEITURA no provedor Resend (paginada, mascarada).
 * Confirma o universo consultado e a ausência (ou presença) de mensagem
 * correspondente; registra limitações (conta/retenção). Nunca envia.
 */
async function investigarResend(opts: {
  destinatario: string;
  assunto: string;
  numero: string;
}): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  console.log("── Resend (provedor, somente leitura) ──");
  if (!key) {
    console.log("  RESEND_API_KEY ausente — LIMITAÇÃO: universo consultável não confirmado.");
    return;
  }
  const H = { Authorization: `Bearer ${key}` };
  try {
    const d = await fetch("https://api.resend.com/domains", { headers: H });
    const dj = (await d.json().catch(() => ({}))) as { data?: { name?: string }[] };
    console.log(`  domínios da conta: ${(dj.data || []).map((x) => x?.name).join(", ") || "(sem)"}`);
  } catch (e) {
    console.log("  domains erro:", e instanceof Error ? e.message : e);
  }

  let cursor: string | undefined;
  let page = 0;
  let total = 0;
  const all: unknown[] = [];
  const pages: number[] = [];
  do {
    const u = `https://api.resend.com/emails?limit=100${cursor ? `&after=${cursor}` : ""}`;
    const r = await fetch(u, { headers: H });
    const j = (await r.json().catch(() => ({}))) as {
      data?: Record<string, unknown>[];
      has_more?: boolean;
      next_cursor?: string;
    };
    page += 1;
    const arr = Array.isArray(j.data) ? j.data : [];
    pages.push(arr.length);
    total += arr.length;
    all.push(...arr);
    cursor = j.has_more ? (j.next_cursor || (arr[arr.length - 1]?.id as string)) : undefined;
    if (page > 50) break;
  } while (cursor);

  const ts = all
    .map((m) => new Date(String((m as Record<string, unknown>).created_at)).getTime())
    .filter((n) => !Number.isNaN(n));
  const min = ts.length ? new Date(Math.min(...ts)).toISOString() : "(sem)";
  const max = ts.length ? new Date(Math.max(...ts)).toISOString() : "(sem)";
  console.log(`  pages=${page} pageSize=${JSON.stringify(pages)} total=${total}`);
  console.log(`  período coberto: ${min} .. ${max}`);

  const alvo = opts.destinatario.toLowerCase();
  const numeroRegex = new RegExp(opts.numero.replace(/[.*+?^${}()|[\]\\]/g, ""), "i");
  const corrNum = all.filter((m) => numeroRegex.test(String((m as Record<string, unknown>).subject || "")));
  const corrTo = all.filter((m) => {
    const to = (m as Record<string, unknown>).to;
    const arr = Array.isArray(to) ? to : [to];
    return arr.some((t) => String(t || "").toLowerCase() === alvo);
  });
  console.log(`  correlação assunto contém "${opts.numero}": ${corrNum.length}`);
  console.log(`  correlação destinatário == esperado (${mascararEmail(opts.destinatario)}): ${corrTo.length}`);
  const instantes = [Date.parse("2026-10-17T00:00:00Z"), Date.parse("2026-10-18T23:59:59Z")];
  const janela = all.filter((m) => {
    const t = new Date(String((m as Record<string, unknown>).created_at)).getTime();
    return t >= instantes[0] && t <= instantes[1];
  });
  console.log(`  mensagens na janela do estorno (2026-10-17..18): ${janela.length}`);
  console.log(
    `  retenção cobre o instante do estorno? ${ts.length && Math.min(...ts) <= Date.parse("2026-10-17T18:34:54.611Z") ? "SIM" : "NÃO — LIMITAÇÃO"}`
  );
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

    // ── Evidência complementar (somente leitura) ──────────────────────────
    const outboxRows = (await prisma.emailOutbox.findMany({
      where: { OR: [{ orderId: pedido.id }, { dedupeKey }] },
      select: {
        dedupeKey: true, status: true, attempt: true,
        sentAt: true, createdAt: true, recipient: true,
      },
      orderBy: { createdAt: "asc" },
    })) as {
      dedupeKey: string; status: string; attempt: number;
      sentAt: Date | null; createdAt: Date; recipient: string;
    }[];
    console.log("── outbox / registros locais de envio (somente leitura) ──");
    console.log(`  linhas p/ pedido ou dedupeKey: ${outboxRows.length}`);
    for (const r of outboxRows) {
      console.log(
        `  - ${r.dedupeKey} | status=${r.status} attempt=${r.attempt} ` +
          `sentAt=${r.sentAt?.toISOString() ?? "(sem)"} to=${mascararEmail(r.recipient)}`
      );
    }
    if (outboxRows.length === 0) {
      console.log("  → nenhum registro local: o e-mail REFUNDED nunca foi enfileirado.");
    }
    await investigarResend({
      destinatario: mail.to,
      assunto: mail.subject,
      numero: pedido.number,
    });
    console.log("────────────────────────────────────────");

    if (!aplicar) {
      console.log(
        "[dry-run] NENHUMA gravação. Para enfileirar, reexecute com --aplicar " +
          "(após autorização). Enfileirar NÃO envia: o script não chama " +
          "processarEmailOutbox — só o dreno (cron) tenta enviar."
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
      "Próximo passo (não executado aqui): o dreno tenta enviar na próxima " +
        "janela — 12:00 UTC (09h local, via /api/cron/carrinho-abandonado) " +
        "ou 21:00 UTC (18h local, via /api/cron/emails). Disparo manual do " +
        "dreno: curl -H \"Authorization: Bearer $CRON_SECRET\" " +
        "https://<app>/api/cron/emails — atenção: isso ENVIA a mensagem " +
        "na hora. O CRON_SECRET só protege o acesso à rota; não é chave de " +
        "desligamento do transporte e sua presença não comprova que " +
        "`EMAIL_DRIVER`+credenciais estão configurados."
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("[backfill 7653] ERRO:", err instanceof Error ? err.message : err);
  process.exit(1);
});
