/**
 * Audita slugs com sufixo numérico (ex.: vestido-pietra-2).
 * Uso: npx tsx scripts/audit-slugs.ts
 * Gera: relatorio-duplicatas.md (raiz) — NÃO apaga nem mescla nada.
 */
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { PrismaClient } from "@prisma/client";

function loadEnv() {
  try {
    const raw = readFileSync(join(process.cwd(), ".env"), "utf8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^([A-Z_]+)="(.*)"$/) || line.match(/^([A-Z_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  } catch {
    // sem .env: usa o ambiente atual
  }
}

function brl(value: unknown): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(Number(value));
}

async function main() {
  loadEnv();
  const prisma = new PrismaClient();

  const all = await prisma.product.findMany({
    where: { deletedAt: null },
    include: { category: { select: { name: true, slug: true } } },
    orderBy: { name: "asc" },
  });
  const flagged = all.filter((p) => /-\d+$/.test(p.slug));

  // agrupa pela base do slug (o que importa para redirects e SEO)
  const groups = new Map<string, { baseSlug: string; items: typeof flagged }>();
  for (const p of flagged) {
    const baseSlug = p.slug.replace(/-\d+$/, "");
    if (!groups.has(baseSlug)) groups.set(baseSlug, { baseSlug, items: [] });
    groups.get(baseSlug)!.items.push(p);
  }
  // inclui as "bases" (sem sufixo) de cada grupo para comparação
  const lines: string[] = [];
  lines.push("# Relatório de slugs com sufixo numérico");
  lines.push("");
  lines.push(`Gerado em ${new Date().toISOString()} — ${flagged.length} produto(s) com slug terminado em número.`);
  lines.push("");
  lines.push("> Nenhum produto foi apagado ou mesclado por este script. Decisão com o dono da loja (ver PENDENCIAS.md).");
  lines.push("");

  for (const { baseSlug, items } of [...groups.values()].sort((a, b) =>
    a.baseSlug.localeCompare(b.baseSlug)
  )) {
    const base = await prisma.product.findFirst({
      where: { slug: baseSlug, deletedAt: null },
      include: { category: { select: { name: true } } },
    });
    const all = [...(base ? [base] : []), ...items];
    const title = base ? base.name : items[0].name;

    lines.push(`## ${title} (base \`${baseSlug}\`${base ? "" : " — APAGADA"}, ${all.length} registro(s))`);
    lines.push("");
    lines.push("| id | nome | slug | categoria | preço | estoque | criado em | pedidos |");
    lines.push("|---|---|---|---|---|---|---|---|");
    for (const p of all) {
      const orders = await prisma.orderItem.count({ where: { productId: p.id } });
      lines.push(
        `| \`${p.id.slice(0, 8)}…\` | ${p.name} | \`${p.slug}\` | ${p.category?.name || "—"} | ${brl(p.price)} | ${p.stock} | ${p.createdAt.toISOString().slice(0, 10)} | ${orders} |`
      );
    }
    const samePrice = new Set(all.map((p) => String(p.price))).size === 1;
    const sameCat = new Set(all.map((p) => p.category?.slug || "")).size === 1;
    const anyOrders = await prisma.orderItem.count({
      where: { productId: { in: all.map((p) => p.id) } },
    });
    lines.push("");
    lines.push(
      `- Provável duplicata real (mesmo nome${sameCat ? " + mesma categoria" : ""}${samePrice ? " + mesmo preço" : ""})? **${samePrice && sameCat ? "SIM — decidir com o dono" : "VERIFICAR"}**`
    );
    lines.push(`- Pedidos associados ao grupo: **${anyOrders}** (impede exclusão simples)`);
    lines.push("");
  }

  writeFileSync(join(process.cwd(), "relatorio-duplicatas.md"), lines.join("\n") + "\n");
  console.log(`OK: ${flagged.length} slugs auditados em ${groups.size} grupo(s) → relatorio-duplicatas.md`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error("FATAL:", e.message);
  process.exit(1);
});
