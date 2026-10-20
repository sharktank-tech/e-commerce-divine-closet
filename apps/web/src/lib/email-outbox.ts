import { prisma } from "@/lib/prisma";
import { sendEmail, type SendEmailInput } from "@/lib/email";
import { montarEmailStatusPedido } from "@/lib/pedidos/notificar-status";

// Outbox de e-mail transacional: persiste o payload renderizado ANTES de
// tentar enviar e retenta com backoff (cron diário) até o provedor aceitar.
//
// Regras de consistência:
// - dedupeKey único (ex.: status:{orderId}:{status}) → webhook repetido ou
//   confirmação simultânea geram no máximo UMA linha (P2002 ignorado);
// - payload imutável (recipient/subject/text/html gravados na enfileiração)
//   → toda tentativa envia bytes idênticos com a mesma Idempotency-Key
//   (Resend deduplica por 24h; limite documentado em
//   EMAIL-ESTORNO-RETENTATIVA.md);
// - SENT só após o provedor ACEITAR (sendEmail resolve) — nunca antes;
// - FAILED = definitivo (configuração/validação ausente ou tentativas
//   esgotadas); SÓ PENDING volta ao dreno.
//
// A tentativa imediata roda logo após a enfileiração (fire-and-forget, sem
// travar quem chama); o dreno roda nos crons diários — 12:00 UTC (09h local,
// em /api/cron/carrinho-abandonado) e 21:00 UTC (18h local, em
// /api/cron/emails) — e pega as vencidas.
//
// Interpretação operacional (não confundir fila com transporte):
// - fila VAZIA não significa transporte desativado: o outbox só recebe
//   linhas quando há ocorrência a notificar; o transporte é EMAIL_DRIVER.
// - CRON_SECRET protege o ACESSO às rotas cron; não é chave de
//   desligamento do envio e sua presença não comprova transporte ativo.
// - EMAIL_DRIVER=mock resolve o envio SEM provedor → a linha vira SENT
//   sem mensagem real: SENT também não é prova de entrega.

export const EMAIL_OUTBOX_MAX_TENTATIVAS = 6;
/** Limite de linhas por rodada de dreno (mesma ordem de grandeza da fila ERP). */
export const EMAIL_OUTBOX_LOTE = 50;

type Db = Pick<typeof prisma, "emailOutbox">;

type LinhaOutbox = {
  id: string;
  dedupeKey: string;
  orderId: string | null;
  recipient: string;
  subject: string;
  text: string | null;
  html: string | null;
  status: string;
  attempt: number;
  nextAttemptAt: Date;
  lastError: string | null;
};

export type ResultadoProcessamento =
  | "ENVIADO"
  | "RETENTAR"
  | "FALHOU"
  | "PULADO";

export function dedupeKeyStatusPedido(orderId: string, status: string): string {
  return `status:${orderId}:${status}`;
}

function erroResumo(err: unknown): string {
  return String((err as Error)?.message ?? err).slice(0, 300);
}

function backoffMinutos(attempt: number): number {
  return Math.min(2 ** attempt, 60);
}

/**
 * Renderiza e grava UMA linha PENDING (idempotente pela dedupeKey). Retorno
 * null = nada a notificar (sem pedido/destinatário) ou linha já existente.
 * Retorna o id da linha (a existente, quando já havia) para tentativa imediata.
 */
export async function enfileirarEmailStatusPedido(
  orderId: string,
  status: string,
  db: Db & Pick<typeof prisma, "order" | "orderTrackToken"> = prisma
): Promise<string | null> {
  const mail = await montarEmailStatusPedido({ orderId, status }, { db });
  if (!mail) return null;

  const dedupeKey = dedupeKeyStatusPedido(orderId, status);
  try {
    const row = await db.emailOutbox.create({
      data: {
        dedupeKey,
        kind: "status_pedido",
        orderId,
        recipient: mail.to,
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
        status: "PENDING",
        attempt: 0,
        nextAttemptAt: new Date(),
      },
    });
    return row.id;
  } catch (err) {
    // corrida/reprocesso: a linha da mesma ocorrência já existe.
    if ((err as { code?: string })?.code === "P2002") {
      const existente = await db.emailOutbox.findUnique({ where: { dedupeKey } });
      return existente?.id ?? null;
    }
    throw err;
  }
}

/**
 * Enfileira UM e-mail arbitrário (payload já renderizado) de forma idempotente
 * pela dedupeKey. Usado pelos caminhos que antes enviavam DIRETO sem retry nem
 * proteção contra duplicidade (confirmação "pedido pago", convite de avaliação):
 * a unique de dedupeKey garante no máximo UMA linha por ocorrência — webhook
 * repetido ou cron concorrente não duplicam o envio. Retorna o id da linha (a
 * existente, quando já havia) para a tentativa imediata.
 */
export async function enfileirarEmail(
  params: {
    dedupeKey: string;
    kind: string;
    orderId?: string | null;
    mail: { to: string; subject: string; text?: string; html?: string | null };
  },
  db: Db = prisma
): Promise<string | null> {
  const { dedupeKey, kind, orderId, mail } = params;
  if (!mail.to || !mail.subject) return null;
  try {
    const row = await db.emailOutbox.create({
      data: {
        dedupeKey,
        kind,
        orderId: orderId ?? null,
        recipient: mail.to,
        subject: mail.subject,
        text: mail.text ?? null,
        html: mail.html ?? null,
        status: "PENDING",
        attempt: 0,
        nextAttemptAt: new Date(),
      },
    });
    return row.id;
  } catch (err) {
    if ((err as { code?: string })?.code === "P2002") {
      const existente = await db.emailOutbox.findUnique({ where: { dedupeKey } });
      return existente?.id ?? null;
    }
    throw err;
  }
}

/**
 * Tenta enviar uma linha PENDING devida. Transições via updateMany com guarda
 * de status → processadores concorrentes não duplicam (um só marca SENT).
 */
export async function processarEmailOutbox(
  id: string,
  deps: {
    db?: Db;
    send?: typeof sendEmail;
    agora?: Date;
  } = {}
): Promise<ResultadoProcessamento> {
  const db = deps.db ?? (prisma as unknown as Db);
  const send = deps.send ?? sendEmail;
  const agora = deps.agora ?? new Date();

  const row = (await db.emailOutbox.findUnique({
    where: { id },
  })) as LinhaOutbox | null;
  if (!row) return "PULADO";
  if (row.status !== "PENDING") return "PULADO";
  if (row.nextAttemptAt.getTime() > agora.getTime()) return "PULADO";

  const payload: SendEmailInput = {
    to: row.recipient,
    subject: row.subject,
    text: row.text ?? undefined,
    html: row.html ?? undefined,
    idempotencyKey: row.dedupeKey,
  };

  try {
    await send(payload);
    const marcado = await db.emailOutbox.updateMany({
      where: { id: row.id, status: "PENDING" },
      data: { status: "SENT", sentAt: new Date(), lastError: null },
    });
    return (marcado.count ?? 0) > 0 ? "ENVIADO" : "PULADO";
  } catch (err) {
    const tentativa = row.attempt + 1;
    const transitorio = (err as { retryable?: boolean }).retryable !== false;
    const esgotou = tentativa >= EMAIL_OUTBOX_MAX_TENTATIVAS;
    const morto = !transitorio || esgotou;

    await db.emailOutbox.updateMany({
      where: { id: row.id, status: "PENDING" },
      data: {
        status: morto ? "FAILED" : "PENDING",
        attempt: tentativa,
        lastError: erroResumo(err),
        ...(morto
          ? {}
          : { nextAttemptAt: new Date(agora.getTime() + backoffMinutos(tentativa) * 60_000) }),
      },
    });
    if (morto) {
      console.error(
        "[email:outbox]",
        row.dedupeKey,
        esgotou ? "esgotou tentativas" : "falha definitiva",
        erroResumo(err)
      );
    }
    return morto ? "FALHOU" : "RETENTAR";
  }
}

/**
 * Drena as linhas PENDING vencidas. Roda nos crons diários e após
 * reprocesso manual (mesmo contrato do drenarEventosErp).
 */
export async function drenarEmailsOutbox(
  db: Db = prisma,
  send: typeof sendEmail = sendEmail
): Promise<{ processados: number; enviados: number; falhas: number }> {
  const agora = new Date();
  const linhas = (await db.emailOutbox.findMany({
    where: { status: "PENDING", nextAttemptAt: { lte: agora } },
    orderBy: { nextAttemptAt: "asc" },
    take: EMAIL_OUTBOX_LOTE,
  })) as LinhaOutbox[];

  let enviados = 0;
  let falhas = 0;
  for (const row of linhas) {
    try {
      const r = await processarEmailOutbox(row.id, { db, send, agora });
      if (r === "ENVIADO") enviados++;
      else if (r === "FALHOU") falhas++;
    } catch (err) {
      console.error("[email:outbox:dreno]", row.id, err);
    }
  }
  return { processados: linhas.length, enviados, falhas };
}
