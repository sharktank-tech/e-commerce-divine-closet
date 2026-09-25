import { NextRequest, NextResponse } from "next/server";
import { shipping } from "@/config/defaults";

// TODO-CLIENTE: substituir por API real da transportadora (Correios/Melhor Envio).
// Tabela fictícia temporária (seção 9): R$ 20 fixo, grátis >= R$ 300.
// Prazo simulado por região do CEP (1º dígito): 0-3 → 3-5 dias, 4-6 → 5-8, 7-9 → 7-12.
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const cep = (searchParams.get("cep") || "").replace(/\D/g, "");
  const subtotal = Number(searchParams.get("subtotal") || 0);

  if (cep.length !== 8) {
    return NextResponse.json({ error: "CEP inválido. Use 8 dígitos." }, { status: 400 });
  }

  const d = Number(cep[0]);
  const [minDays, maxDays] = d <= 3 ? [3, 5] : d <= 6 ? [5, 8] : [7, 12];
  const freeShipping = subtotal >= shipping.freeFrom;
  const price = freeShipping ? 0 : shipping.fixed;

  return NextResponse.json({
    cep,
    subtotal,
    freeShipping,
    freeFrom: shipping.freeFrom,
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
