import { PrismaClient } from "@prisma/client";
import { comDescontoDerivado } from "./desconto-sync";

const globalForPrisma = globalThis as unknown as {
  prisma?: ReturnType<typeof criarClient>;
};

function criarClient() {
  const base = new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

  return base.$extends({
    query: {
      product: {
        // discountPercent é derivado de price/comparePrice (ver
        // lib/desconto-sync.ts): recalculado aqui em toda escrita, por
        // qualquer origem, para nunca dessincronizar de Ofertas/filtros.
        async create({ args, query }) {
          args.data = comDescontoDerivado(args.data);
          return query(args);
        },
        async createMany({ args, query }) {
          const data = Array.isArray(args.data)
            ? args.data.map((d) => comDescontoDerivado(d))
            : comDescontoDerivado(args.data);
          return query({ ...args, data });
        },
        async update({ args, query }) {
          args.data = await comAtual(args.where, args.data);
          return query(args);
        },
        async upsert({ args, query }) {
          args.create = comDescontoDerivado(args.create);
          args.update = await comAtual(args.where, args.update, args.create);
          return query(args);
        },
        // updateMany não tem contexto por linha: só deriva quando os dois
        // campos vêm juntos. (Nenhum chamador atual usa este caminho.)
        async updateMany({ args, query }) {
          if (args.data.price !== undefined && args.data.comparePrice !== undefined) {
            args.data = comDescontoDerivado(args.data);
          }
          return query(args);
        },
      },
    },
  });

  // Mescla escrita parcial (só price ou só comparePrice) com o gravado.
  async function comAtual(
    where: Parameters<typeof base.product.findUnique>[0]["where"],
    data: Parameters<typeof base.product.update>[0]["data"],
    base2?: { price?: unknown; comparePrice?: unknown } | null
  ) {
    if (
      typeof data !== "object" ||
      data === null ||
      (data.price === undefined && data.comparePrice === undefined)
    ) {
      return data;
    }
    if (data.price !== undefined && data.comparePrice !== undefined) {
      return comDescontoDerivado(data);
    }
    const atual =
      (await base.product.findUnique({
        where,
        select: { price: true, comparePrice: true },
      })) ?? base2 ?? null;
    return comDescontoDerivado(data, atual);
  }
}

// Singleton em todos os ambientes: no serverless (Vercel) reaproveita o client
// entre invocações da mesma instância e evita esgotar o pool do Supabase.
if (!globalForPrisma.prisma) {
  globalForPrisma.prisma = criarClient();
}

export const prisma = globalForPrisma.prisma;
