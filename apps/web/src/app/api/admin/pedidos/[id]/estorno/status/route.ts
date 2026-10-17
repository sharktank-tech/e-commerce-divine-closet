import { NextRequest, NextResponse } from "next/server";
import { requireAuth, forbidden } from "@/lib/auth";
import { reconciliarEstorno, EstornoErro } from "@/lib/estorno";

type Params = { params: Promise<{ id: string }> };

// POST /api/admin/pedidos/[id]/estorno/status
// Reconcilia tentativas abertas (REQUESTED/IN_PROCESS) com o provedor:
// consulta GET /v1/payments/{id}/refunds e aplica o estado real.
export async function POST(_req: NextRequest, { params }: Params) {
  try {
    const session = await requireAuth("ADMIN");
    if (!session) return forbidden();

    const { id } = await params;
    const resultado = await reconciliarEstorno({ orderId: id });
    return NextResponse.json(resultado);
  } catch (err) {
    if (err instanceof EstornoErro) {
      return NextResponse.json(
        { error: err.message, codigo: err.codigo },
        { status: err.httpStatus }
      );
    }
    console.error("[admin:pedido:estorno-status]", err);
    return NextResponse.json({ error: "Erro ao verificar status" }, { status: 500 });
  }
}
