import type { Coupon } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// Cache in-memory de cupons por código (item 10) — uma instância por
// processo (no serverless, cada instância tem sua cópia; TTL curto +
// invalidação nas escritas mantêm a divergência pequena e transitória).
//
// Política de segurança: só armazena cupons SEM maxUses (ilimitados). Com
// limite, o usedCount muda a cada pedido e o cache estouraria o limite —
// esses sempre leem do banco. Os demais campos (active, datas, mínimo) só
// mudam por edição admin, que invalida. Expiração por data se auto-avalia
// (o `endsAt` gravado é comparado com o agora a cada uso).
//
// Concorrência: Node é single-thread; dois misses simultâneos no pior caso
// geram duas leituras ao banco com o mesmo valor — sem corrupção.

export const TTL_PADRAO_MS = 5 * 60 * 1000;

export function ttlCuponsMs(): number {
  const v = Number(process.env.CUPOM_CACHE_TTL_MS);
  return Number.isFinite(v) && v > 0 ? v : TTL_PADRAO_MS;
}

export function criarCache<T>(opcoes: {
  ttlMs: number;
  agora?: () => number;
}) {
  const mapa = new Map<string, { valor: T; expiraEm: number }>();
  const agora = opcoes.agora ?? Date.now;
  let hits = 0;
  let misses = 0;

  return {
    obter(chave: string): T | null {
      const item = mapa.get(chave);
      if (!item) {
        misses++;
        return null;
      }
      if (item.expiraEm <= agora()) {
        mapa.delete(chave);
        misses++;
        return null;
      }
      hits++;
      return item.valor;
    },
    guardar(chave: string, valor: T): void {
      mapa.set(chave, { valor, expiraEm: agora() + opcoes.ttlMs });
    },
    invalidar(chave: string): boolean {
      return mapa.delete(chave);
    },
    invalidarTudo(): void {
      mapa.clear();
    },
    stats(): { hits: number; misses: number; tamanho: number } {
      return { hits, misses, tamanho: mapa.size };
    },
  };
}

export type CacheCupons = ReturnType<typeof criarCache<Coupon>>;

const cache: CacheCupons = criarCache<Coupon>({ ttlMs: ttlCuponsMs() });

export function invalidarCupom(codigo: string): void {
  cache.invalidar(codigo.trim().toUpperCase());
}

export function estatisticasCupomCache(): {
  hits: number;
  misses: number;
  tamanho: number;
} {
  return cache.stats();
}

export async function obterCupom(
  codigo: string,
  buscar: (codigo: string) => Promise<Coupon | null> = (c) =>
    prisma.coupon.findUnique({ where: { code: c } })
): Promise<{ cupom: Coupon | null; origem: "cache" | "banco" }> {
  const chave = codigo.trim().toUpperCase();
  const emCache = cache.obter(chave);
  if (emCache) return { cupom: emCache, origem: "cache" };
  const cupom = await buscar(chave);
  if (cupom && cupom.maxUses == null) cache.guardar(chave, cupom);
  return { cupom, origem: "banco" };
}
