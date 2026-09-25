import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, forbidden } from "@/lib/auth";
import { toNumber } from "@/lib/utils";

// Relatórios exportáveis em CSV (seção 4.7) — base para BI via exportação/API.

function csvCell(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(rows: Array<Record<string, unknown>>): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  return [
    headers.join(";"),
    ...rows.map((r) => headers.map((h) => csvCell(r[h])).join(";")),
  ].join("\n");
}

export async function GET(req: NextRequest) {
  try {
    const session = await requireAuth("ADMIN");
    if (!session) return forbidden();

    const { searchParams } = req.nextUrl;
    const tipo = searchParams.get("tipo") || "vendas";
    const csv = searchParams.get("formato") === "csv";
    const deRaw = searchParams.get("de");
    const ateRaw = searchParams.get("ate");

    const de = deRaw ? new Date(`${deRaw}T00:00:00`) : new Date(0);
    const ate = ateRaw ? new Date(`${ateRaw}T23:59:59`) : new Date();

    let rows: Array<Record<string, unknown>> = [];
    const filename = `relatorio-${tipo}.csv`;

    if (tipo === "vendas") {
      const orders = await prisma.order.findMany({
        where: { createdAt: { gte: de, lte: ate }, deletedAt: null },
        include: {
          items: { include: { product: { include: { category: true } } } },
          user: { select: { name: true, email: true } },
        },
        orderBy: { createdAt: "asc" },
      });

      rows = orders.flatMap((o) =>
        o.items.map((it) => ({
          pedido: o.number,
          data: o.createdAt.toISOString().slice(0, 10),
          cliente: o.user?.name || o.guestName || o.guestEmail || "Convidado",
          status: o.status,
          produto: it.productName,
          categoria: it.product?.category?.name || "",
          quantidade: it.quantity,
          unitario: toNumber(it.unitPrice),
          item_total: toNumber(it.total),
          frete: toNumber(o.shipping),
          desconto: toNumber(o.discount),
          cupom: o.couponCode || "",
          pedido_total: toNumber(o.total),
        }))
      );
    } else if (tipo === "categoria") {
      const orders = await prisma.order.findMany({
        where: {
          createdAt: { gte: de, lte: ate },
          deletedAt: null,
          paymentStatus: "PAID",
        },
        include: {
          items: { include: { product: { include: { category: true } } } },
        },
      });

      const byCat = new Map<string, { quantidade: number; receita: number }>();
      for (const o of orders) {
        for (const it of o.items) {
          const cat = it.product?.category?.name || "Sem categoria";
          const agg = byCat.get(cat) || { quantidade: 0, receita: 0 };
          agg.quantidade += it.quantity;
          agg.receita += toNumber(it.total);
          byCat.set(cat, agg);
        }
      }
      rows = [...byCat.entries()].map(([categoria, a]) => ({
        categoria,
        quantidade: a.quantidade,
        receita: a.receita,
      }));
    } else if (tipo === "cupons") {
      const orders = await prisma.order.findMany({
        where: {
          createdAt: { gte: de, lte: ate },
          deletedAt: null,
          couponCode: { not: null },
        },
        select: { couponCode: true, discount: true, total: true, paymentStatus: true },
      });

      const byCode = new Map<string, { usos: number; desconto: number; receita: number }>();
      for (const o of orders) {
        const code = o.couponCode!;
        const agg = byCode.get(code) || { usos: 0, desconto: 0, receita: 0 };
        agg.usos++;
        agg.desconto += toNumber(o.discount);
        agg.receita += toNumber(o.total);
        byCode.set(code, agg);
      }

      const coupons = await prisma.coupon.findMany({ where: { deletedAt: null } });
      rows = coupons.map((c) => {
        const agg = byCode.get(c.code) || { usos: 0, desconto: 0, receita: 0 };
        return {
          codigo: c.code,
          tipo: c.type,
          valor: toNumber(c.value),
          usos: agg.usos,
          desconto_total: agg.desconto,
          receita_pedidos: agg.receita,
          ativo: c.active ? "sim" : "não",
        };
      });
    } else if (tipo === "carrinho") {
      // Abandono: carrinho com itens e sem atualização há 2+ horas.
      const limite = new Date(Date.now() - 2 * 60 * 60 * 1000);
      const carts = await prisma.cart.findMany({
        where: { updatedAt: { lte: limite }, items: { some: {} } },
        include: {
          items: { include: { product: true } },
          user: { select: { name: true, email: true } },
        },
        orderBy: { updatedAt: "desc" },
        take: 500,
      });

      rows = carts.map((c) => ({
        atualizado_em: c.updatedAt.toISOString().slice(0, 16).replace("T", " "),
        cliente: c.user?.name || c.user?.email || "Convidado",
        itens: c.items.reduce((s, i) => s + i.quantity, 0),
        valor_estimado: c.items.reduce(
          (s, i) => s + Number(i.product.price) * i.quantity,
          0
        ),
      }));
    } else {
      return NextResponse.json({ error: "Tipo de relatório inválido" }, { status: 400 });
    }

    if (csv) {
      const content = toCsv(rows);
      return new NextResponse(content, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${filename}"`,
        },
      });
    }

    return NextResponse.json({ rows, total: rows.length });
  } catch (err) {
    console.error("[admin:relatorios]", err);
    return NextResponse.json({ error: "Erro ao gerar relatório" }, { status: 500 });
  }
}
