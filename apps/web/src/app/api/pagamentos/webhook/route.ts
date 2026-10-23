import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { comErro } from "@/lib/erros";
import { finalizarPedidoPago } from "@/lib/pedidos/finalizar";
import {
  buscarPagamento,
  extrairAssinatura,
  mapearStatusMp,
  validarIdentidadePagamento,
  verificarAssinaturaWebhook,
} from "@/lib/mercadopago";
import { confirmarEstornoNotificado } from "@/lib/estorno";

// Webhook do Mercado Pago (pagamentos assíncronos, ex.: Pix).
// Configure a URL `https://<app>/api/pagamentos/webhook` no painel do MP.
// Idempotente: só finaliza pedido ainda PENDING; reenvios não duplicam nada.
export const POST = comErro(async (req: NextRequest) => {
  const body = (await req.json().catch(() => null)) as {
    type?: string;
    action?: string;
    data?: { id?: string | number };
  } | null;

  // MP envia `?data.id=...&type=...` na query E o mesmo no body; o
  // manifesto da assinatura é calculado sobre o data.id da query — ler
  // query primeiro e cair para o body mantém os dois formatos válidos.
  const query = req.nextUrl.searchParams;
  const dataId = query.get("data.id") || (body?.data?.id != null ? String(body.data.id) : "");
  const tipo =
    query.get("type") || body?.type || (body?.action || "").split(".")[0];
  if (tipo !== "payment" || !dataId) {
    return NextResponse.json({ received: true });
  }

  const token = process.env.MP_ACCESS_TOKEN;
  if (!token) {
    return NextResponse.json(
      { error: "MP_ACCESS_TOKEN não configurado" },
      { status: 500 }
    );
  }

  const segredo = process.env.MP_WEBHOOK_SECRET || null;
  if (segredo) {
    const sig = extrairAssinatura(req.headers.get("x-signature"));
    const requestId = req.headers.get("x-request-id") || "";
    if (
      !sig ||
      !verificarAssinaturaWebhook(dataId, requestId, sig.ts, sig.v1, segredo)
    ) {
      return NextResponse.json({ error: "Assinatura inválida" }, { status: 401 });
    }
  } else {
    console.warn(
      "[webhook:mp] sem MP_WEBHOOK_SECRET — assinatura não verificada (configure em produção)"
    );
  }

  const pagamento = await buscarPagamento(token, dataId);
  if (!pagamento.referenciaExterna) {
    return NextResponse.json({ received: true });
  }

  // Pagamento estornado no provedor (ex.: estorno solicitado no admin +
  // confirmação assíncrona, ou estorno feito fora daqui): registra/fecha o
  // estorno local e marca o pedido REFUNDED (idempotente, guarda por status).
  if (pagamento.status === "refunded") {
    await confirmarEstornoNotificado({
      paymentId: pagamento.id,
      orderId: pagamento.referenciaExterna,
    });
    return NextResponse.json({ ok: true });
  }

  if (mapearStatusMp(pagamento.status) !== "PAID") {
    return NextResponse.json({ received: true });
  }

  const order = await prisma.order.findUnique({
    where: { id: pagamento.referenciaExterna },
    select: {
      id: true,
      status: true,
      paymentStatus: true,
      total: true,
      paymentId: true,
    },
  });
  if (!order) {
    return NextResponse.json({ received: true });
  }

  // IDENTIDADE DO PAGAMENTO (revisão PR #16): antes de transicionar o pedido,
  // confirma-se que a notificação descreve ESTE pedido — mesmo pagamento
  // (associação), mesma moeda e mesmo valor. Sem isso, um pagamento de outro
  // pedido/valor com a mesma external_reference, ou uma notificação antiga
  // pós-recriação, confirmava o pedido errado. Divergência NÃO confirma e NÃO
  // cancela: registra o diagnóstico e responde 200 (o provedor para de
  // reenviar; a decisão fica com o admin, que tem o log).
  const divergencia = validarIdentidadePagamento(pagamento, {
    id: order.id,
    total: Number(order.total),
    paymentId: order.paymentId,
  });
  if (!divergencia.ok) {
    console.error(`[webhook:divergencia-${divergencia.tipo}]`, divergencia.detalhe);
    return NextResponse.json({ received: true, divergencia: divergencia.tipo });
  }

  // Fora de PENDING: nada a fazer (idempotente). Um pedido em RETENÇÃO
  // (paymentStatus=PAID + hold por falta de estoque) também cai aqui — a
  // aprovação já está registrada e a resolução é do admin.
  if (order.status !== "PENDING" || order.paymentStatus !== "PENDING") {
    return NextResponse.json({ received: true });
  }

  const r = await finalizarPedidoPago(order.id, pagamento.id);
  return NextResponse.json({
    ok: true,
    ...(r.emEspera ? { emEspera: true, hold: r.hold ?? null } : {}),
  });
}, { rota: "pagamentos-webhook" });
