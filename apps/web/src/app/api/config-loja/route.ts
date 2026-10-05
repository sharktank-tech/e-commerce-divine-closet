import { NextResponse } from "next/server";
import { getEmpresa, getFrete, getPagamento } from "@/lib/config-loja";

// Configuração pública da loja (o que o painel define e a vitrine consome).
// Sem segredos: só empresa (exibição), frete e formas de pagamento.
export async function GET() {
  try {
    const [empresa, frete, pagamento] = await Promise.all([
      getEmpresa(),
      getFrete(),
      getPagamento(),
    ]);
    return NextResponse.json(
      { empresa, frete, pagamento },
      { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" } }
    );
  } catch (err) {
    console.error("[config-loja]", err);
    return NextResponse.json({ error: "Erro ao carregar configuração" }, { status: 500 });
  }
}
