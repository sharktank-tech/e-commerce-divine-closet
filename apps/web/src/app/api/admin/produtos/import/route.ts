import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAuth, forbidden } from "@/lib/auth";
import { slugify } from "@/lib/utils";

// Importação em massa via planilha CSV (seção 4.3).
// Colunas: nome,descricao,preco,estoque,categoria,sku,tamanhos,cores
// Tamanhos/cores separados por "|". Exemplo:
// Vestido Floral,Descrição da peça,189.90,10,Vestidos,VST-001,P|PP|M,Verde|Preto

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

const schema = z.object({ csv: z.string().min(1) });

export async function POST(req: NextRequest) {
  try {
    const session = await requireAuth("ADMIN");
    if (!session) return forbidden();

    const body = await req.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "CSV vazio" }, { status: 400 });
    }

    const lines = parsed.data.csv
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);

    if (lines.length < 2) {
      return NextResponse.json(
        { error: "CSV precisa de cabeçalho + ao menos 1 linha de dados" },
        { status: 400 }
      );
    }

    const header = parseCsvLine(lines[0]).map((h) => h.toLowerCase());
    const col = (name: string) => header.indexOf(name);
    const iName = col("nome");
    const iDesc = col("descricao");
    const iPrice = col("preco");
    const iStock = col("estoque");
    const iCat = col("categoria");
    const iSku = col("sku");
    const iSizes = col("tamanhos");
    const iColors = col("cores");

    if (iName < 0 || iPrice < 0) {
      return NextResponse.json(
        { error: "Cabeçalho precisa conter ao menos: nome, preco" },
        { status: 400 }
      );
    }

    let created = 0;
    const errors: string[] = [];
    const categories = new Map<string, string>();

    for (let li = 1; li < lines.length; li++) {
      const cols = parseCsvLine(lines[li]);
      const name = cols[iName] || "";
      const price = Number((cols[iPrice] || "").replace(",", "."));
      if (!name || !Number.isFinite(price) || price <= 0) {
        errors.push(`Linha ${li + 1}: nome/preço inválidos`);
        continue;
      }

      try {
        let categoryId: string;
        const catName = (iCat >= 0 ? cols[iCat] : "") || "Geral";
        const cached = categories.get(catName.toLowerCase());
        if (cached) {
          categoryId = cached;
        } else {
          let cat = await prisma.category.findFirst({
            where: { name: { equals: catName, mode: "insensitive" }, deletedAt: null },
          });
          if (!cat) {
            let slug = slugify(catName);
            const slugExists = await prisma.category.findUnique({ where: { slug } });
            if (slugExists) slug = `${slug}-${Date.now().toString(36)}`;
            cat = await prisma.category.create({
              data: { name: catName, slug },
            });
          }
          categoryId = cat.id;
          categories.set(catName.toLowerCase(), cat.id);
        }

        let slug = slugify(name);
        const slugExists = await prisma.product.findUnique({ where: { slug } });
        if (slugExists) slug = `${slug}-${Date.now().toString(36)}`;

        const sizes = iSizes >= 0 ? (cols[iSizes] || "").split("|").map((s) => s.trim()).filter(Boolean) : [];
        const colors = iColors >= 0 ? (cols[iColors] || "").split("|").map((s) => s.trim()).filter(Boolean) : [];
        const stock = iStock >= 0 ? Math.max(0, Number(cols[iStock]) || 0) : 0;

        await prisma.product.create({
          data: {
            name,
            slug,
            description: (iDesc >= 0 && cols[iDesc]) || name,
            price,
            stock,
            sku: (iSku >= 0 && cols[iSku]) || null,
            sizes,
            colors,
            categoryId,
          },
        });
        created++;
      } catch (e) {
        errors.push(`Linha ${li + 1}: ${e instanceof Error ? e.message : "erro"}`);
      }
    }

    return NextResponse.json({ created, errors });
  } catch (err) {
    console.error("[admin:produtos:import]", err);
    return NextResponse.json({ error: "Erro ao importar CSV" }, { status: 500 });
  }
}
