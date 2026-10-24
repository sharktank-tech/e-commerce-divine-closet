import { liberarCupomReservado } from "@/lib/pedidos/cupom-reserva";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAuth, forbidden } from "@/lib/auth";
import { validarUrlRastreio } from "@/lib/rastreio";
import { enfileirarEvento, entregarEvento } from "@/lib/erp";
import {
  enfileirarEmailStatusPedido,
  processarEmailOutbox,
} from "@/lib/email-outbox";
import { deveNotificarStatus } from "@/lib/pedidos/notificar-status";
import { finalizarPedidoPago } from "@/lib/pedidos/finalizar";

const schema = z.object({
  status: z.enum([
    "PENDING",
    "PAID",
    "PROCESSING",
    "SHIPPED",
    "DELIVERED",
    "CANCELLED",
    "REFUNDED",
  ]),
  paymentStatus: z.enum(["PENDING", "PAID", "FAILED", "REFUNDED"]).optional(),
  trackingCode: z.string().nullish(),
  trackingCarrier: z.string().trim().max(80).nullish(),
  // Link externo de rastreio: validado no servidor (HTTPS + allowlist);
  // URL fora da regra é gravada como null (nunca exibida ao cliente).
  trackingUrl: z.string().trim().max(2048).nullish(),
  // Liberação de RETENÇÃO (hold): pedido pago sem estoque. O admin repõe o
  // saldo, marca `liberarHold: true` e o servidor re-tenta a finalização
  // (baixa de estoque + evento de venda). Se o saldo ainda não cobre, o
  // pedido volta para a retenção — nunca é faturado no escuro.
  liberarHold: z.boolean().optional(),
});

/** Status que representam faturamento/envio — bloqueados enquanto há hold. */
const STATUS_DE_FATURAMENTO = new Set(["PROCESSING", "SHIPPED", "DELIVERED"]);

// MÁQUINA DE ESTADOS DO PEDIDO.
// Antes o PATCH aceitava qualquer alvo: o admin podia regredir DELIVERED →
// PENDING, pular fases, e — o mais grave — marcar REFUNDED à mão. REFUNDED
// manual gravava o pedido como estornado SEM criar a linha `Refund` (que é
// 1:1 e só nasce com confirmação real do provedor), quebrando a auditoria do
// estorno e deixando o pedido sem rastro de quem devolveu o dinheiro.
//
// REFUNDED agora é alcançável SÓ pelo fluxo de estorno
// (/api/admin/pedidos/{id}/estornar), que registra o Refund e transiciona com
// guarda própria. O mesmo status é permitido (no-op: rastreio pode ser
// atualizado sem mudar de fase).
const TRANSICOESPermitidas: Record<string, readonly string[]> = {
  PENDING: ["PAID", "CANCELLED"],
  PAID: ["PROCESSING", "SHIPPED", "DELIVERED", "CANCELLED"],
  PROCESSING: ["SHIPPED", "DELIVERED", "CANCELLED"],
  SHIPPED: ["DELIVERED"],
  DELIVERED: [],
  CANCELLED: [],
  REFUNDED: [],
};

function transicaoPermitida(de: string, para: string): boolean {
  if (de === para) return true; // no-op (ex.: divulgar rastreio no mesmo status)
  return (TRANSICOESPermitidas[de] ?? []).includes(para);
}

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const session = await requireAuth("ADMIN");
    if (!session) return forbidden();

    const { id } = await params;
    const order = await prisma.order.findUnique({
      where: { id },
      include: {
        items: true,
        refund: true,
        user: { select: { id: true, name: true, email: true, phone: true } },
        address: true,
      },
    });

    if (!order) return NextResponse.json({ error: "Não encontrado" }, { status: 404 });
    return NextResponse.json({ order });
  } catch (err) {
    console.error("[admin:pedido:get]", err);
    return NextResponse.json({ error: "Erro ao carregar" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const session = await requireAuth("ADMIN");
    if (!session) return forbidden();

    const { id } = await params;
    const body = await req.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Status inválido" }, { status: 400 });
    }

    // Estado anterior p/ anti-duplicado: só notifica quando o status muda
    // ou quando o rastreio é divulgado pela 1ª vez. Também é a base da
    // guarda de transição (a corrida é resolvida pela trava da linha dentro
    // da tx, mas a checagem aqui evita abrir transação para um alvo inválido).
    const anterior = await prisma.order.findUnique({
      where: { id },
      select: { status: true, paymentStatus: true, trackingCode: true, holdCode: true },
    });
    if (!anterior) return NextResponse.json({ error: "Não encontrado" }, { status: 404 });

    // RETENÇÃO (hold): pagamento aprovado, sem estoque. Enquanto existir,
    // o pedido não pode faturar/enviar — o dinheiro foi recebido, mas a
    // operação ainda não resolveu a falta de saldo.
    const emRetencao = Boolean(anterior.holdCode);
    if (emRetencao && !parsed.data.liberarHold) {
      if (STATUS_DE_FATURAMENTO.has(parsed.data.status)) {
        return NextResponse.json(
          {
            error:
              `Pedido em retenção (${anterior.holdCode}): pagamento aprovado, mas o estoque não cobre a demanda. ` +
              "Reponha o estoque e envie `liberarHold: true` para liberar, ou use o fluxo de estorno.",
          },
          { status: 409 }
        );
      }
    }

    if (anterior.holdCode === "REVISAO_FINANCEIRA" && parsed.data.status !== anterior.status) {
      return NextResponse.json({ error: "Resolva a revisão financeira antes de alterar o estado comercial." }, { status: 409 });
    }

    // REFUNDED é exclusivo do fluxo de estorno (registra a linha Refund 1:1
    // com o idempotencyKey do provedor). Setar à mão deixava o pedido
    // "estornado" sem nenhum registro de quem devolveu o dinheiro.
    if (parsed.data.status === "REFUNDED") {
      return NextResponse.json(
        {
          error:
            "Use o fluxo de estorno (/api/admin/pedidos/{id}/estornar) para marcar como estornado — ele registra o estorno junto do pedido.",
        },
        { status: 409 }
      );
    }
    if (parsed.data.paymentStatus === "REFUNDED") {
      return NextResponse.json(
        { error: "paymentStatus REFUNDED só é aplicado pela confirmação do estorno." },
        { status: 409 }
      );
    }
    if (!transicaoPermitida(anterior.status, parsed.data.status)) {
      return NextResponse.json(
        { error: `Transição inválida: ${anterior.status} → ${parsed.data.status}` },
        { status: 409 }
      );
    }

    // LIBERAÇÃO DE RETENÇÃO: limpa o hold e RE-TENTA a finalização (a
    // finalização tem trava própria e confere o estoque de novo). Se o saldo
    // ainda não cobre, o pedido volta para a retenção e a resposta diz isso —
    // nunca se fatura sem estoque. O status alvo do PATCH é ignorado aqui
    // (a finalização decide: PAID ou retenção).
    if (parsed.data.liberarHold) {
      if (!emRetencao) {
        return NextResponse.json(
          { error: "Pedido não está em retenção." },
          { status: 409 }
        );
      }
      if (anterior.holdCode !== "ESTOQUE_INSUFICIENTE" || anterior.paymentStatus !== "PAID") {
        return NextResponse.json({ error: "Retenção financeira exige revisão; liberação de estoque não permitida." }, { status: 409 });
      }
      const r = await finalizarPedidoPago(id, undefined, undefined, true);
      const depois = await prisma.order.findUnique({
        where: { id },
        select: { id: true, status: true, paymentStatus: true, holdCode: true, holdReason: true },
      });
      return NextResponse.json({
        order: depois,
        liberado: Boolean(depois && !depois.holdCode && depois.status !== "PENDING"),
        emRetencao: Boolean(depois?.holdCode),
        ...(r.emEspera ? { hold: r.hold ?? null } : {}),
      });
    }

    if ((parsed.data.paymentStatus && parsed.data.paymentStatus !== anterior.paymentStatus) ||
        (anterior.status === "PENDING" && parsed.data.status === "PAID") ||
        (parsed.data.status === "CANCELLED" && anterior.paymentStatus === "PAID")) {
      return NextResponse.json({ error: "Estado financeiro só pode mudar pelo fluxo de pagamento/estorno." }, { status: 409 });
    }

    // Transição + evento ERP + notificação na MESMA transação (evento só ao
    // entrar em CANCELLED; e-mail só com mudança real — businessKey/dedupeKey
    // únicas: se outro caminho (estorno, reconciliação) já registrou, não
    // duplica). O envio em si é pós-commit, com retentativa via outbox.
    const { order, eventoId: eventoCancelId, emailId } = await prisma.$transaction(async (tx) => {
      const order = await tx.order.update({
        where: { id, status: anterior.status, paymentStatus: anterior.paymentStatus, holdCode: anterior.holdCode ?? null },
        data: {
          status: parsed.data.status,
          ...(parsed.data.status === "CANCELLED" && anterior.paymentStatus === "PENDING" ? { paymentStatus: "FAILED" as const } : {}),
          ...(parsed.data.trackingCode !== undefined
            ? { trackingCode: parsed.data.trackingCode || null }
            : {}),
          ...(parsed.data.trackingCarrier !== undefined
            ? { trackingCarrier: parsed.data.trackingCarrier || null }
            : {}),
          ...(parsed.data.trackingUrl !== undefined
            ? { trackingUrl: parsed.data.trackingUrl ? validarUrlRastreio(parsed.data.trackingUrl) : null }
            : {}),
          // marca a entrega (base do convite de avaliação pós-compra)
          ...(parsed.data.status === "DELIVERED" ? { entregueEm: new Date() } : {}),
        },
        include: {
          items: true,
          user: { select: { email: true, name: true } },
        },
      });
      if (order.status === "CANCELLED" && anterior.status !== "CANCELLED") await liberarCupomReservado(tx, id);
      let eventoId: string | null = null;
      if (order.status === "CANCELLED" && anterior.status !== "CANCELLED") {
        eventoId = await enfileirarEvento(
          "pedido_cancelado",
          { numero: order.number, motivo: "Cancelado pela administração" },
          { db: tx, businessKey: `pedido_cancelado:${order.id}` }
        );
      }
      let emailId: string | null = null;
      if (
        deveNotificarStatus(anterior, {
          status: order.status,
          trackingCode: order.trackingCode,
        })
      ) {
        // template do status REAL (não mais "atualizado" genérico); payload
        // imutável gravado junto da transição — idempotente pela dedupeKey.
        emailId = await enfileirarEmailStatusPedido(
          order.id,
          order.status,
          tx as Parameters<typeof enfileirarEmailStatusPedido>[2]
        );
      }
      return { order, eventoId, emailId };
    });
    if (eventoCancelId) {
      void entregarEvento(eventoCancelId).catch((err) =>
        console.error("[admin:pedido:erp]", err)
      );
    }
    if (emailId) {
      void processarEmailOutbox(emailId).catch((err) =>
        console.error("[admin:pedido:email]", err)
      );
    }

    return NextResponse.json({ order });
  } catch (err) {
    if ((err as { code?: string })?.code === "P2025") return NextResponse.json({ error: "Pedido mudou; atualize e tente novamente." }, { status: 409 });
    console.error("[admin:pedido:patch]", err);
    return NextResponse.json({ error: "Erro ao atualizar" }, { status: 500 });
  }
}
