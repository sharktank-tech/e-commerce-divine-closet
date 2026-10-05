import { NextRequest, NextResponse } from "next/server";
import { getFrete } from "@/lib/config-loja";
import { validarCep } from "@/lib/validacao";

// TODO-CLIENTE: substituir por API real da transportadora (Correios/Melhor Envio).
// Tabela fictícia temporária (seção 9): R$ 20 fixo, grátis >= R$ 300.
// Prazo simulado por região do CEP (1º dígito): 0-3 → 3-5 dias, 4-6 → 5-8, 7-9 → 7-12.
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const cepParam = searchParams.get("cep") || "";
  const subtotal = Number(searchParams.get("subtotal") || 0);

  if (validarCep(cepParam) !== "OK") {
    return NextResponse.json({ error: "CEP inválido. Use 8 dígitos." }, { status: 400 });
  }
  const cep = cepParam.replace(/\D/g, "");

  const d = Number(cep[0]);
  const [minDays, maxDays] = d <= 3 ? [3, 5] : d <= 6 ? [5, 8] : [7, 12];
  // Frete do painel (Setting.frete) — cai no padrão se não configurado.
  const freteCfg = await getFrete();
  const freeShipping = subtotal >= freteCfg.freeFrom;
  const price = freeShipping ? 0 : freteCfg.fixed;

  return NextResponse.json({
    cep,
    subtotal,
    freeShipping,
    freeFrom: freteCfg.freeFrom,
    delivery: [
      {
        id: "padrao",
        name: "Entrega padrão",
        price,
        days: `${minDays}-${maxDays}`,
        eta: `em até ${maxDays} dias úteis`,
      },
    ],
  });
}
