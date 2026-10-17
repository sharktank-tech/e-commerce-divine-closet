import { NextRequest, NextResponse } from "next/server";
import { requireAuth, forbidden } from "@/lib/auth";
import { solicitarEstorno, EstornoErro } from "@/lib/estorno";

type Params = { params: Promise<{ id: string }> };

// POST /api/admin/pedidos/[id]/estornar
// Estorno INTEGRAL via Mercado Pago. Nunca marca o pedido como estornado
// aqui — só após confirmação do provedor (approved), via aplicarResultado
// ou webhook. Admin (mesma proteção de /api/admin do middleware).
export async function POST(_req: NextRequest, { params }: Params) {
  try {
    const session = await requireAuth("ADMIN");
    if (!session) return forbidden();

    const { id } = await params;
    const registro = await solicitarEstorno({ orderId: id, adminId: session.sub });
    return NextResponse.json({ refund: registro });
  } catch (err) {
    if (err instanceof EstornoErro) {
      return NextResponse.json(
        { error: err.message, codigo: err.codigo },
        { status: err.httpStatus }
      );
    }
    console.error("[admin:pedido:estornar]", err);
    return NextResponse.json({ error: "Erro ao solicitar estorno" }, { status: 500 });
  }
}
