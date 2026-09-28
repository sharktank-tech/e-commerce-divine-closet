import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { summarizeReviews } from "@/lib/avaliacoes";

const createSchema = z.object({
  productId: z.string().min(1),
  orderId: z.string().min(1),
  rating: z.number().int().min(1).max(5),
  titulo: z.string().max(80).nullish(),
  texto: z.string().min(10, "Conte um pouco mais (mín. 10 caracteres)").max(2000),
  tamanhoComprado: z.string().max(10).nullish(),
  caimento: z.enum(["pequeno", "ideal", "grande"]).nullish(),
  alturaCliente: z.string().max(10).nullish(),
  fotos: z
    .array(
      z
        .string()
        .max(500)
        .refine(
          (u) => u.startsWith("/uploads/") || /^https?:\/\//.test(u),
          "Foto inválida"
        )
    )
    .max(3, "Máximo 3 fotos")
    .default([]),
});

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl;
    const produto = searchParams.get("produto") || "";
    const page = Math.max(1, Number(searchParams.get("page") || 1));
    const pageSize = Math.min(20, Number(searchParams.get("pageSize") || 10));
    const ordem = searchParams.get("ordem") || "recentes";
    const comFotos = searchParams.get("comFotos") === "1";

    // slug ou id: a busca por id com texto não-UUID quebraria (P2023),
    // então o ramo id só entra para formato UUID
    const isUuid = /^[0-9a-f-]{36}$/i.test(produto);
    const product = await prisma.product.findFirst({
      where: {
        OR: isUuid ? [{ slug: produto }, { id: produto }] : [{ slug: produto }],
        deletedAt: null,
      },
      select: { id: true },
    });
    if (!product) return NextResponse.json({ items: [], total: 0, summary: null });

    const where = {
      productId: product.id,
      status: "APROVADA" as const,
      deletedAt: null,
      ...(comFotos ? { fotos: { some: {} } } : {}),
    };

    const orderBy =
      ordem === "melhores"
        ? { rating: "desc" as const }
        : { createdAt: "desc" as const };

    const [total, items, all] = await Promise.all([
      prisma.review.count({ where }),
      prisma.review.findMany({
        where,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          user: { select: { name: true } },
          fotos: { orderBy: { ordem: "asc" as const } },
        },
      }),
      prisma.review.findMany({
        where: { productId: product.id, status: "APROVADA", deletedAt: null },
        select: { rating: true, caimento: true, fotos: { select: { id: true } } },
        take: 500,
      }),
    ]);

    const shaped = items.map((r) => ({
      id: r.id,
      rating: r.rating,
      titulo: r.titulo,
      texto: r.comment,
      tamanhoComprado: r.tamanhoComprado,
      caimento: r.caimento,
      alturaCliente: r.alturaCliente,
      respostaLoja: r.respostaLoja,
      compraVerificada: true,
      autor: (r.user?.name || "Cliente").split(" ")[0],
      createdAt: r.createdAt,
      fotos: r.fotos.map((f) => f.url),
    }));

    return NextResponse.json({
      items: shaped,
      total,
      page,
      totalPages: Math.ceil(total / pageSize) || 1,
      summary: summarizeReviews(
        all.map((r) => ({ rating: r.rating, caimento: r.caimento, fotos: r.fotos }))
      ),
    });
  } catch (err) {
    console.error("[avaliacoes:list]", err);
    return NextResponse.json({ error: "Erro ao carregar avaliações" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession(req);
    if (!session) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

    const body = await req.json();
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "Dados inválidos" },
        { status: 400 }
      );
    }

    const d = parsed.data;
    const order = await prisma.order.findFirst({
      where: { id: d.orderId, userId: session.sub, deletedAt: null },
      include: { items: { select: { productId: true } } },
    });
    if (!order) {
      return NextResponse.json({ error: "Pedido não encontrado" }, { status: 404 });
    }
    if (order.paymentStatus !== "PAID" && order.status !== "DELIVERED") {
      return NextResponse.json(
        { error: "Só é possível avaliar pedidos pagos ou entregues" },
        { status: 403 }
      );
    }
    if (!order.items.some((i) => i.productId === d.productId)) {
      return NextResponse.json(
        { error: "Produto não pertence a este pedido" },
        { status: 403 }
      );
    }
    const existing = await prisma.review.findUnique({
      where: { orderId_productId: { orderId: d.orderId, productId: d.productId } },
    });
    if (existing) {
      return NextResponse.json({ error: "Este produto já foi avaliado neste pedido" }, { status: 409 });
    }

    const review = await prisma.review.create({
      data: {
        userId: session.sub,
        productId: d.productId,
        orderId: d.orderId,
        rating: d.rating,
        titulo: d.titulo || null,
        comment: d.texto,
        tamanhoComprado: d.tamanhoComprado || null,
        caimento: d.caimento || null,
        alturaCliente: d.alturaCliente || null,
        status: "PENDENTE",
        fotos:
          d.fotos.length > 0
            ? { create: d.fotos.map((url, i) => ({ url, ordem: i })) }
            : undefined,
      },
    });

    return NextResponse.json(
      { ok: true, id: review.id, message: "Avaliação enviada! Ela aparece após moderação." },
      { status: 201 }
    );
  } catch (err) {
    console.error("[avaliacoes:create]", err);
    return NextResponse.json({ error: "Erro ao enviar avaliação" }, { status: 500 });
  }
}
