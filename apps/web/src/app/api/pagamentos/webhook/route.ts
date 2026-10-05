import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { comErro } from "@/lib/erros";
import { finalizarPedidoPago } from "@/lib/pedidos/finalizar";
import {
  buscarPagamento,
  extrairAssinatura,
  mapearStatusMp,
  verificarAssinaturaWebhook,
} from "@/lib/mercadopago";

// Webhook do Mercado Pago (pagamentos assíncronos, ex.: Pix).
// Configure a URL `https://<app>/api/pagamentos/webhook` no painel do MP.
// Idempotente: só finaliza pedido ainda PENDING; reenvios não duplicam nada.
export const POST = comErro(async (req: NextRequest) => {
  const body = (await req.json().catch(() => null)) as {
    type?: string;
    action?: string;
    data?: { id?: string | number };
  } | null;

  const tipo = body?.type || (body?.action || "").split(".")[0];
  const dataId = body?.data?.id != null ? String(body.data.id) : "";
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
  if (mapearStatusMp(pagamento.status) !== "PAID") {
    return NextResponse.json({ received: true });
  }

  const order = await prisma.order.findUnique({
    where: { id: pagamento.referenciaExterna },
    select: { id: true, paymentStatus: true },
  });
  if (!order || order.paymentStatus !== "PENDING") {
    return NextResponse.json({ received: true });
  }

  await finalizarPedidoPago(order.id, pagamento.id);
  return NextResponse.json({ ok: true });
}, { rota: "pagamentos-webhook" });
