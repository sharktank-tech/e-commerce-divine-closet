import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, forbidden } from "@/lib/auth";
import { drenarEventosErp, erpConfigurado } from "@/lib/erp";

// Status da fila de eventos ERP (NUNCA expõe payload/dados de pedidos) +
// reprocessamento manual das tentativas pendentes.

export async function GET() {
  try {
    const session = await requireAuth("ADMIN");
    if (!session) return forbidden();

    const configurado = erpConfigurado();
    const [pendentes, entregues, falharam, mortos, ultimas] = await Promise.all([
      prisma.erpEvent.count({ where: { status: "PENDING" } }),
      prisma.erpEvent.count({ where: { status: "DELIVERED" } }),
      prisma.erpEvent.count({ where: { status: "FAILED" } }),
      prisma.erpEvent.count({ where: { status: "DEAD" } }),
      prisma.erpEvent.findMany({
        orderBy: { createdAt: "desc" },
        take: 15,
        select: {
          id: true,
          tipo: true,
          status: true,
          attempt: true,
          lastStatusCode: true,
          lastError: true,
          nextAttemptAt: true,
          createdAt: true,
        },
      }),
    ]);

    return NextResponse.json({
      configurado,
      contagens: { PENDING: pendentes, DELIVERED: entregues, FAILED: falharam, DEAD: mortos },
      ultimas,
    });
  } catch (err) {
    console.error("[admin:erp:get]", err);
    return NextResponse.json({ error: "Erro ao carregar fila" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireAuth("ADMIN");
    if (!session) return forbidden();
    if (req.nextUrl.searchParams.get("acao") !== "reprocessar") {
      return NextResponse.json({ error: "Ação inválida" }, { status: 400 });
    }
    if (!erpConfigurado()) {
      return NextResponse.json(
        { error: "ERP não configurado (ERP_WEBHOOK_URL/SECRET)." },
        { status: 400 }
      );
    }

    // reagenda tudo que não foi entregue e tenta drenar agora
    const reagendados = await prisma.erpEvent.updateMany({
      where: { status: { in: ["PENDING", "FAILED"] } },
      data: { nextAttemptAt: new Date() },
    });
    const dreno = await drenarEventosErp();
    return NextResponse.json({ reagendados: reagendados.count, ...dreno });
  } catch (err) {
    console.error("[admin:erp:post]", err);
    return NextResponse.json({ error: "Erro ao reprocessar" }, { status: 500 });
  }
}
