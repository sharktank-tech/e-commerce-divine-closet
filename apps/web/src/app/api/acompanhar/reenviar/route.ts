import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { emails, sendEmail } from "@/lib/email";
import { processarReenvio } from "@/lib/pedidos/acompanhar";
import { consumirRateLimit, ipDoPedido } from "@/lib/rate-limit";

const schema = { email: z.string().trim().email("E-mail inválido") };
const MSG_GENERICA =
  "Se houver pedidos com este e-mail, o link foi enviado. " +
  "Confira também a caixa de spam — pode levar alguns minutos.";

// POST /api/acompanhar/reenviar — reenvio do link privado para CONVIDADO.
// Resposta SEMPRE idêntica (com ou sem pedidos, limite atingido ou não):
// não confirma existência de contas/pedidos (anti-enumeração). O envio
// respeita limite de tentativas + espera por pedido (lib/acompanhar) e um
// rate-limit por IP em Postgres (lib/rate-limit) — o limite TAMPOU é
// revelado (mesma resposta genérica) para não virar oráculo.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const parsed = schema.email.safeParse(body?.email);
    if (!parsed.success) {
      return NextResponse.json({ error: "Informe um e-mail válido." }, { status: 400 });
    }

    const rl = await consumirRateLimit(`reenviar:ip:${ipDoPedido(req.headers)}`, {
      limite: 10,
      janelaMin: 60,
    });
    if (!rl.permitido) {
      return NextResponse.json({ ok: true, mensagem: MSG_GENERICA });
    }

    const resultado = await processarReenvio({ email: parsed.data });
    if (resultado.enviou && resultado.links.length > 0) {
      sendEmail({
        to: parsed.data.trim().toLowerCase(),
        ...emails.acompanharPedidos(resultado.links),
      }).catch((err) => console.error("[acompanhar:email]", err));
    }

    return NextResponse.json({ ok: true, mensagem: MSG_GENERICA });
  } catch (err) {
    console.error("[acompanhar:reenviar]", err);
    return NextResponse.json({ error: "Erro ao processar" }, { status: 500 });
  }
}
