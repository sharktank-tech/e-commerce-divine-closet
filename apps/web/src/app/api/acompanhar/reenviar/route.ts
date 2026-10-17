import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { emails, sendEmail } from "@/lib/email";
import { processarReenvio } from "@/lib/pedidos/acompanhar";

const schema = z.object({ email: z.string().trim().email("E-mail inválido") });

// POST /api/acompanhar/reenviar — reenvio do link privado para CONVIDADO.
// Resposta SEMPRE idêntica (com ou sem pedidos, limite atingido ou não):
// não confirma existência de contas/pedidos (anti-enumeração). O envio
// respeita limite de tentativas + espera por pedido (lib/acompanhar).
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Informe um e-mail válido." }, { status: 400 });
    }

    const resultado = await processarReenvio({ email: parsed.data.email });
    if (resultado.enviou && resultado.links.length > 0) {
      sendEmail({
        to: parsed.data.email.trim().toLowerCase(),
        ...emails.acompanharPedidos(resultado.links),
      }).catch((err) => console.error("[acompanhar:email]", err));
    }

    return NextResponse.json({
      ok: true,
      mensagem:
        "Se houver pedidos com este e-mail, o link foi enviado. " +
        "Confira também a caixa de spam — pode levar alguns minutos.",
    });
  } catch (err) {
    console.error("[acompanhar:reenviar]", err);
    return NextResponse.json({ error: "Erro ao processar" }, { status: 500 });
  }
}
