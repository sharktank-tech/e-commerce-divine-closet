import { NextRequest, NextResponse } from "next/server";
import { getFrete } from "@/lib/config-loja";
import { validarCep } from "@/lib/validacao";
import { calcularFrete } from "@/lib/frete";
import { elegibilidadeCupom } from "@/lib/elegibilidade-cupom";
import { obterCupom } from "@/lib/cupom-cache";
import { comErro } from "@/lib/erros";

// TODO-CLIENTE: substituir por API real da transportadora (Correios/Melhor Envio).
// Fonte única do frete: mesmo pipeline de /api/cupom e /api/pedidos
// (lib/pedidos/calculo-total.ts) — o valor exibido aqui é o que será
// cobrado. `cupom` é opcional: cupom inválido/inelegível é ignorado aqui
// (o erro específico aparece no fluxo de cupom do checkout).
export const GET = comErro(async (req: NextRequest) => {
  const { searchParams } = req.nextUrl;
  const cepParam = searchParams.get("cep") || "";
  const subtotal = Number(searchParams.get("subtotal") || 0);
  const cupomParam = searchParams.get("cupom")?.trim().toUpperCase() || null;

  if (validarCep(cepParam) !== "OK") {
    return NextResponse.json({ error: "CEP inválido. Use 8 dígitos." }, { status: 400 });
  }
  const cep = cepParam.replace(/\D/g, "");

  let cupom: { type: "PERCENT" | "FIXED" | "FREE_SHIPPING"; value: unknown } | null = null;
  if (cupomParam) {
    const { cupom: encontrado } = await obterCupom(cupomParam);
    if (encontrado && elegibilidadeCupom(encontrado, new Date(), subtotal).elegivel) {
      cupom = { type: encontrado.type, value: encontrado.value };
    }
  }

  const freteCfg = await getFrete();
  const frete = calcularFrete(cep, subtotal, cupom, freteCfg);

  return NextResponse.json({
    cep,
    subtotal,
    cupom: cupomParam,
    freteGratisCupom: cupom?.type === "FREE_SHIPPING",
    freeShipping: frete.gratis,
    freeFrom: freteCfg.freeFrom,
    delivery: [
      {
        id: "padrao",
        name: "Entrega padrão",
        price: frete.precoReais,
        days: `${frete.prazo.min}-${frete.prazo.max}`,
        eta: frete.eta,
      },
    ],
  });
}, { rota: "frete" });
