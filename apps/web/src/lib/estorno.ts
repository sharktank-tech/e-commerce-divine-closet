import { randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";
import {
  criarEstornoMp,
  listarEstornosMp,
  traduzirErroMp,
} from "@/lib/mercadopago";
import { entregarEvento, enfileirarEvento } from "@/lib/erp";
import {
  enfileirarEmailStatusPedido,
  processarEmailOutbox,
} from "@/lib/email-outbox";

// Orquestração de estorno INTEGRAL via Mercado Pago.
// Regra de ouro: o pedido só passa a REFUNDED/APPROVED quando o provedor
// CONFIRMA. Tentativa em curso/interrompida = REQUESTED (nunca afeta o
// pedido). Estorno não devolve estoque automaticamente (o item pode já
// estar em trânsito) — cancelamento de pedido é o único que devolve.

export type CodigoEstorno =
  | "NAO_ENCONTRADO"
  | "NAO_PAGA"
  | "SEM_PAGAMENTO"
  | "SEM_TOKEN"
  | "JA_ESTORNADO"
  | "EM_ANDAMENTO"
  | "RECUSADO"
  | "CONFIRMACAO_INCERTA"
  | "SEM_ESTORNO"
  | "PROVEDOR_INDISPONIVEL";

export class EstornoErro extends Error {
  constructor(
    public readonly codigo: CodigoEstorno,
    message: string,
    public readonly httpStatus = 400
  ) {
    super(message);
    this.name = "EstornoErro";
  }
}

type Db = Pick<typeof prisma, "order" | "refund" | "$transaction">;

export type RegistroEstorno = {
  id: string;
  status: string;
  mpRefundId: string | null;
  attempt: number;
  idempotencyKey: string;
  lastError: string | null;
};

/** Erro do provedor não vaza na UI: truncado e sem credenciais. */
export function sanitizarErro(motivo: string): string {
  return motivo
    .replace(/Bearer\s+\S+/gi, "Bearer ***")
    .replace(/[A-Za-z0-9_\-]{40,}/g, "***")
    .slice(0, 300);
}

function paraRegistro(r: {
  id: string;
  status: string;
  mpRefundId: string | null;
  attempt: number;
  idempotencyKey: string;
  lastError: string | null;
}): RegistroEstorno {
  return {
    id: r.id,
    status: r.status,
    mpRefundId: r.mpRefundId,
    attempt: r.attempt,
    idempotencyKey: r.idempotencyKey,
    lastError: r.lastError,
  };
}

/**
 * Transição PAID→REFUNDED + evento `pedido_estornado` na MESMA transação:
 * ou existe as duas coisas, ou nenhuma (rollback → reconciliação/reprocesso
 * tenta de novo — nunca fica estorno sem evento na fila, que foi o defeito).
 * Guardas idempotentes: só PAID→REFUNDED no pagamento e só estados anteriores
 * de envio no status (nunca regride SHIPPED/DELIVERED/CANCELLED); a
 * businessKey única por pedido impede evento duplicado em concorrência.
 * ATENÇÃO: não devolve estoque (estorno não é devolução automática).
 */
async function transicionarEstornoComEvento(
  db: Db,
  orderId: string,
  dadosErp: { numero: string; total: number }
): Promise<{ mudou: boolean; eventoId: string | null; emailId: string | null }> {
  try {
    return (await db.$transaction(async (tx) => {
      const mudou =
        ((await tx.order.updateMany({
          where: { id: orderId, paymentStatus: "PAID" },
          data: { paymentStatus: "REFUNDED" },
        })).count ?? 0) > 0;
      await tx.order.updateMany({
        where: { id: orderId, status: { in: ["PENDING", "PAID", "PROCESSING"] } },
        data: { status: "REFUNDED" },
      });
      if (!mudou) return { mudou: false, eventoId: null, emailId: null };
      const eventoId = await enfileirarEvento(
        "pedido_estornado",
        { numero: dadosErp.numero, total: dadosErp.total },
        { db: tx, businessKey: `pedido_estornado:${orderId}` }
      );
      // E-mail na MESMA transação: ou a transição REFUNDED nasce com a linha
      // do outbox gravada, ou o rollback descarta as duas (nunca fica estorno
      // sem notificação — o envio em si é pós-commit, com retentativa).
      const emailId = await enfileirarEmailStatusPedido(
        orderId,
        "REFUNDED",
        tx as Parameters<typeof enfileirarEmailStatusPedido>[2]
      );
      return { mudou: true, eventoId, emailId };
    })) as { mudou: boolean; eventoId: string | null; emailId: string | null };
  } catch (err) {
    // Átomo: falhou junto = nada aplicado; loga e deixa a reconciliação
    // reprocessar (nunca responde erro ao provedor por isso).
    console.error("[estorno:transicao]", err);
    return { mudou: false, eventoId: null, emailId: null };
  }
}

/** Entrega pós-commit (I/O externo fora da tx); a fila cuida das retentativas. */
function entregarEventoEstorno(eventoId: string | null): void {
  if (!eventoId) return;
  void entregarEvento(eventoId).catch((err) =>
    console.error("[estorno:erp:entrega]", err)
  );
}

/**
 * E-mail do estado REFUNDED (template de estorno). A linha do outbox já foi
 * gravada DENTRO da transição PAID→REFUNDED (dedupeKey impede duplicado); aqui
 * só se tenta o envio imediato — falha transitória fica PENDING para o cron.
 * Não bloqueia a orquestração.
 */
function tentarEnvioEmailRefund(emailId: string | null): void {
  if (!emailId) return;
  void processarEmailOutbox(emailId).catch((err) => {
    console.error("[estorno:email]", err);
  });
}

/**
 * Quando o provedor confirma o pagamento como refunded (webhook/manual):
 * registra/aprova o estorno (1:1) e marca o pedido REFUNDED.
 * Idempotente — notificações repetidas não alteram nada.
 */
export async function confirmarEstornoNotificado(
  input: { paymentId: string; orderId: string | null },
  db: Db = prisma
): Promise<void> {
  const { paymentId, orderId } = input;
  if (!orderId) return;
  const order = await db.order.findUnique({
    where: { id: orderId },
    select: { id: true, number: true, total: true },
  });
  if (!order) return;

  // Registro local: aproveita o pendente, senão cria o histórico (1:1).
  const registro = await db.refund.findUnique({ where: { orderId } });
  if (registro) {
    if (registro.status !== "APPROVED") {
      await db.refund.updateMany({
        where: { orderId, status: { not: "APPROVED" } },
        data: { status: "APPROVED", resolvedAt: new Date(), lastError: null },
      });
    }
  } else {
    try {
      await db.refund.create({
        data: {
          orderId,
          paymentId,
          amount: order.total,
          status: "APPROVED",
          idempotencyKey: `mp:${paymentId}`,
          requestedBy: null,
          resolvedAt: new Date(),
        },
      });
    } catch (err) {
      // corrida com outra notificação (unique orderId) — segue adiante.
      if ((err as { code?: string })?.code !== "P2002") throw err;
    }
  }

  const { mudou, eventoId, emailId } = await transicionarEstornoComEvento(db, orderId, {
    numero: order.number,
    total: Number(order.total),
  });
  if (mudou) {
    entregarEventoEstorno(eventoId);
    tentarEnvioEmailRefund(emailId);
  }
}

async function aplicarResultado(
  db: Db,
  registro: RegistroEstorno,
  refund: { id?: string; status: string },
  lastError: string | null = null,
  orderId?: string
): Promise<RegistroEstorno> {
  if (refund.status === "approved") {
    await db.refund.updateMany({
      where: { id: registro.id, status: { not: "APPROVED" } },
      data: {
        status: "APPROVED",
        resolvedAt: new Date(),
        lastError: null,
        ...(refund.id ? { mpRefundId: refund.id } : {}),
      },
    });
    if (orderId) {
      // O evento precisa dos dados do pedido DENTRO da tx da transição →
      // carrega antes; falha de leitura não derruba a resposta (a
      // reconciliação reprocessa este resultado aprovado).
      let dados: { numero: string; total: number } | null = null;
      try {
        const o = await db.order.findUnique({
          where: { id: orderId },
          select: { number: true, total: true },
        });
        if (o) dados = { numero: o.number, total: Number(o.total) };
      } catch (err) {
        console.error("[estorno:erp:dados]", err);
      }
      if (!dados) {
        console.error("[estorno:transicao] pedido sem dados para transição", orderId);
      } else {
        const { mudou, eventoId, emailId } = await transicionarEstornoComEvento(db, orderId, dados);
        if (mudou) {
          entregarEventoEstorno(eventoId);
          tentarEnvioEmailRefund(emailId);
        }
      }
    }
  } else if (refund.status === "in_process") {
    await db.refund.updateMany({
      where: { id: registro.id, status: { in: ["REQUESTED", "REJECTED"] } },
      data: { status: "IN_PROCESS", ...(refund.id ? { mpRefundId: refund.id } : {}) },
    });
  } else {
    // rejected/cancelled
    await db.refund.updateMany({
      where: { id: registro.id, status: { in: ["REQUESTED", "IN_PROCESS"] } },
      data: { status: "REJECTED", resolvedAt: new Date(), lastError },
    });
  }
  const atual = await db.refund.findUnique({ where: { id: registro.id } });
  return atual ? paraRegistro(atual) : registro;
}

function escolherRefundMp(
  refunds: Array<{ id: string; status: string; amount: number | null }>,
  amountEsperado: number
): { id: string; status: string; amount: number | null } | null {
  if (refunds.length === 0) return null;
  // Estorno integral: prioriza o de valor compatível; senão, o mais recente.
  const porValor = refunds.find(
    (r) => r.amount == null || Math.abs(r.amount - amountEsperado) < 0.02
  );
  return porValor || refunds[refunds.length - 1];
}

/**
 * Solicita estorno integral de um pedido PAGO.
 * Idempotente: registro 1:1 por pedido (unique) + chave de idempotência do
 * MP reutilizada no retry de tentativa incerta; concorrência resolvida por
 * guarda condicional (quem não vence o estado, recebe 409).
 */
export async function solicitarEstorno(
  input: { orderId: string; adminId?: string | null; token?: string | null },
  db: Db = prisma
): Promise<RegistroEstorno> {
  const token = input.token ?? process.env.MP_ACCESS_TOKEN ?? null;

  const order = await db.order.findUnique({ where: { id: input.orderId } });
  if (!order) {
    throw new EstornoErro("NAO_ENCONTRADO", "Pedido não encontrado.", 404);
  }
  if (order.paymentStatus === "REFUNDED") {
    throw new EstornoErro("JA_ESTORNADO", "Pedido já está estornado.", 409);
  }
  if (order.paymentStatus !== "PAID") {
    throw new EstornoErro(
      "NAO_PAGA",
      "Só é possível estornar pedido com pagamento aprovado (PAID).",
      400
    );
  }
  if (!order.paymentId) {
    throw new EstornoErro(
      "SEM_PAGAMENTO",
      "Pedido sem identificador de pagamento no Mercado Pago.",
      400
    );
  }
  if (!token) {
    throw new EstornoErro(
      "SEM_TOKEN",
      "MP_ACCESS_TOKEN não configurado — estorno indisponível.",
      503
    );
  }

  const existente = await db.refund.findUnique({ where: { orderId: order.id } });
  let registro: RegistroEstorno | null = existente ? paraRegistro(existente) : null;
  if (registro?.status === "APPROVED") {
    throw new EstornoErro("JA_ESTORNADO", "Estorno já aprovado.", 409);
  }
  if (registro?.status === "IN_PROCESS") {
    throw new EstornoErro(
      "EM_ANDAMENTO",
      "Estorno em processamento no Mercado Pago. Use “Verificar status”.",
      409
    );
  }

  const amountEsperado = Number(order.total);

  // Tentativa anterior com resposta perdida (REQUESTED): antes de reenviar,
  // reconcilia com o provedor — se já existe refund, não duplica.
  if (registro && registro.status === "REQUESTED") {
    const lista = await listarEstornosMp(token, order.paymentId);
    if (lista.ok) {
      const encontrado = escolherRefundMp(lista.refunds, amountEsperado);
      if (encontrado && (encontrado.status === "approved" || encontrado.status === "in_process")) {
        registro = await aplicarResultado(db, registro, encontrado, null, order.id);
        return registro;
      }
    }
    // sem confirmação → reenvio com a MESMA chave (idempotente no MP)
  }

  let chave: string;
  if (registro && registro.status === "REQUESTED") {
    chave = registro.idempotencyKey;
  } else if (registro) {
    // REJECTED: nova tentativa → chave nova (a antiga devolveria o mesmo "rejected")
    chave = randomUUID();
    await db.refund.updateMany({
      where: { id: registro.id, status: "REJECTED" },
      data: {
        status: "REQUESTED",
        attempt: { increment: 1 },
        idempotencyKey: chave,
        lastError: null,
        resolvedAt: null,
      },
    });
  } else {
    chave = randomUUID();
    try {
      await db.refund.create({
        data: {
          orderId: order.id,
          paymentId: order.paymentId,
          amount: order.total,
          status: "REQUESTED",
          idempotencyKey: chave,
          requestedBy: input.adminId ?? null,
        },
      });
    } catch (err) {
      if ((err as { code?: string })?.code === "P2002") {
        throw new EstornoErro(
          "EM_ANDAMENTO",
          "Já existe uma solicitação de estorno em andamento.",
          409
        );
      }
      throw err;
    }
  }

  const base = await db.refund.findUnique({ where: { orderId: order.id } });
  if (!base) {
    throw new EstornoErro("NAO_ENCONTRADO", "Registro de estorno não encontrado.", 404);
  }
  const registroAtual = base;

  const resp = await criarEstornoMp(token, order.paymentId, chave);

  if (resp.ok) {
    return await aplicarResultado(db, registroAtual, resp.refund, null, order.id);
  }

  if (resp.httpStatus === 409) {
    // refund já em curso no provedor (outra tentativa/processo)
    await db.refund.updateMany({
      where: { id: registroAtual.id, status: { in: ["REQUESTED", "REJECTED"] } },
      data: { status: "IN_PROCESS" },
    });
    const atual = await db.refund.findUnique({ where: { id: registroAtual.id } });
    return atual ? paraRegistro(atual) : registroAtual;
  }

  const motivo = sanitizarErro(traduzirErroMp(resp.motivo));

  if (resp.incerto || (resp.httpStatus && resp.httpStatus >= 500)) {
    // Estado no provedor desconhecido: mantém REQUESTED + chave igual p/ retry.
    await db.refund.updateMany({
      where: { id: registroAtual.id, status: "REQUESTED" },
      data: { lastError: motivo },
    });
    throw new EstornoErro(
      "CONFIRMACAO_INCERTA",
      "Não foi possível confirmar a solicitação no Mercado Pago. " +
        "Clique em “Verificar status do estorno” antes de tentar de novo — " +
        "repetir é seguro (chave de idempotência).",
      502
    );
  }

  // 4xx do provedor: recusado de fato.
  await db.refund.updateMany({
    where: { id: registroAtual.id, status: { in: ["REQUESTED", "REJECTED"] } },
    data: { status: "REJECTED", resolvedAt: new Date(), lastError: motivo },
  });
  throw new EstornoErro(
    "RECUSADO",
    `Mercado Pago recusou o estorno: ${motivo}`,
    400
  );
}

/**
 * Consulta o provedor para fechar tentativas abertas (REQUESTED/IN_PROCESS).
 * Nunca muda o pedido para pior: só a confirmação aprova.
 */
export async function reconciliarEstorno(
  input: { orderId: string; token?: string | null },
  db: Db = prisma
): Promise<{ registro: RegistroEstorno; confirmado: boolean }> {
  const token = input.token ?? process.env.MP_ACCESS_TOKEN ?? null;
  const registro = await db.refund.findUnique({ where: { orderId: input.orderId } });
  if (!registro) {
    throw new EstornoErro("SEM_ESTORNO", "Pedido sem solicitação de estorno.", 404);
  }
  if (registro.status === "APPROVED" || registro.status === "REJECTED") {
    return { registro: paraRegistro(registro), confirmado: true };
  }
  if (!token) {
    throw new EstornoErro("SEM_TOKEN", "MP_ACCESS_TOKEN não configurado.", 503);
  }

  const order = await db.order.findUnique({
    where: { id: input.orderId },
    select: { paymentId: true, total: true },
  });
  if (!order?.paymentId) {
    throw new EstornoErro("SEM_PAGAMENTO", "Pedido sem pagamento registrado.", 400);
  }

  const lista = await listarEstornosMp(token, order.paymentId);
  if (!lista.ok) {
    throw new EstornoErro(
      "PROVEDOR_INDISPONIVEL",
      `Não foi possível consultar o Mercado Pago: ${sanitizarErro(lista.motivo)}`,
      502
    );
  }

  const encontrado = escolherRefundMp(lista.refunds, Number(order.total));
  if (encontrado) {
    const aplicado = await aplicarResultado(
      db,
      paraRegistro(registro),
      encontrado,
      null,
      input.orderId
    );
    return { registro: aplicado, confirmado: true };
  }

  // Nenhum refund no provedor: tentativa ainda não chegou lá.
  if (registro.status === "REQUESTED") {
    return { registro: paraRegistro(registro), confirmado: false };
  }
  // IN_PROCESS sem refund visível: mantém (não regride estado).
  return { registro: paraRegistro(registro), confirmado: false };
}
