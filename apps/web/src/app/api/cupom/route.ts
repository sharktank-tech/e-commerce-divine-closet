import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { toNumber } from "@/lib/utils";
import { getFrete } from "@/lib/config-loja";
import {
  calcularPedido,
  centavosParaReais,
} from "@/lib/pedidos/calculo-total";
import { reaisParaCentavos } from "@/lib/carrinho-revalidacao";
import { elegibilidadeCupom } from "@/lib/elegibilidade-cupom";
import { obterCupom } from "@/lib/cupom-cache";
import { comErro } from "@/lib/erros";

/**
 * Aplica cupom no carrinho do usuário/convidado.
 * TODO-CLIENTE: campanhas reais de cupom via admin.
 */
export const POST = comErro(async (req: NextRequest) => {
  try {
    const { code, subtotal } = (await req.json()) as {
      code?: string;
      subtotal?: number;
    };

    if (!code?.trim()) {
      return NextResponse.json({ error: "Informe o código do cupom" }, { status: 400 });
    }

    // Leitura com cache (só ilimitados; com limite sempre lê do banco).
    // Header x-cupom-cache (HIT/MISS) é observabilidade aditiva.
    const { cupom: coupon, origem } = await obterCupom(code.trim());
    const cabecalhoCache = { "x-cupom-cache": origem === "cache" ? "HIT" : "MISS" };

    const now = new Date();
    const sub = Number(subtotal || 0);
    // Mesma regra de /api/pedidos (lib/elegibilidade-cupom.ts); só as
    // mensagens/status abaixo são desta rota.
    const elig = elegibilidadeCupom(coupon, now, sub);
    if (!elig.elegivel) {
      if (elig.motivo === "minimo" && coupon?.minSubtotal != null) {
        return NextResponse.json(
          {
            error: `Cupom exige pedido mínimo de R$ ${toNumber(coupon.minSubtotal).toFixed(2)}`,
          },
          { status: 400, headers: cabecalhoCache }
        );
      }
      return NextResponse.json({ error: "Cupom inválido ou expirado" }, { status: 404, headers: cabecalhoCache });
    }
    if (!coupon) {
      // Inalcançável (elegibilidade já cobre nulo); guarda de tipo.
      return NextResponse.json({ error: "Cupom inválido ou expirado" }, { status: 404 });
    }

    // Frete do painel (Setting.frete) — cai no padrão se não configurado.
    const { descontoCentavos, freteGratis, freteCentavos } = calcularPedido(
      reaisParaCentavos(sub),
      { type: coupon.type, value: coupon.value },
      await getFrete()
    );
    const shippingCost = centavosParaReais(freteCentavos);

    return NextResponse.json(
      {
        coupon: {
          code: coupon.code,
          type: coupon.type,
          value: toNumber(coupon.value),
        },
        discount: centavosParaReais(descontoCentavos),
        freeShipping: freteGratis,
        shipping: shippingCost,
      },
      { headers: cabecalhoCache }
    );
  } catch (err) {
    console.error("[cupom]", err);
    return NextResponse.json({ error: "Erro ao validar cupom" }, { status: 500 });
  }
}, { rota: "cupom" });
