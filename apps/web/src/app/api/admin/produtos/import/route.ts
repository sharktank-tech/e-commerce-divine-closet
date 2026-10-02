import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAuth, forbidden } from "@/lib/auth";
import { slugify } from "@/lib/utils";
import { normalizarCustoCsv, temOrigemCusto, adicionarSemCusto } from "@/lib/import-csv";
import { registrarMudancaPreco } from "@/lib/historico-preco";
import { reaisParaCentavos } from "@/lib/carrinho-revalidacao";
import { calcularSnapshot } from "@/lib/precificacao-server";

// Importação em massa via planilha CSV (seção 4.3).
// Colunas: nome,descricao,preco,preco_de,estoque,categoria,sku,tamanhos,cores
// Opcionais de custo: lote_id (UUID), lote (nome), custo_peca (R$),
// markup (0–1000), custos_extras (R$). Com origem de custo, grava os mesmos
// snapshots do formulário manual; sem elas, importa sem custo (lista semCusto).
// Tamanhos/cores separados por "|". Exemplo:
// Vestido Floral,Descrição da peça,189.90,,10,Vestidos,VST-001,P|PP|M,Verde|Preto

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
    const iDe = col("preco_de");
    const iStock = col("estoque");
    const iCat = col("categoria");
    const iSku = col("sku");
    const iSizes = col("tamanhos");
    const iColors = col("cores");
    const iLoteId = col("lote_id");
    const iLote = col("lote");
    const iCustoPeca = col("custo_peca");
    const iMarkup = col("markup");
    const iExtras = col("custos_extras");

    if (iName < 0 || iPrice < 0) {
      return NextResponse.json(
        { error: "Cabeçalho precisa conter ao menos: nome, preco" },
        { status: 400 }
      );
    }

    let created = 0;
    const errors: string[] = [];
    const semCusto: string[] = [];
    const categories = new Map<string, string>();
    const lotes = new Map<string, string | null>();

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
        // preco_de (opcional): preço "de" para oferta. discountPercent é
        // derivado via hook do client (lib/desconto-sync.ts).
        const rawDe = iDe >= 0 ? (cols[iDe] || "").replace(",", ".") : "";
        const comparePrice = rawDe ? Number(rawDe) : null;

        // Custo (opcional): mesmas regras do formulário manual. Sem origem
        // de custo, importa normalmente e sinaliza no relatório (semCusto).
        const { custo, erro: erroCusto } = normalizarCustoCsv({
          lote_id: iLoteId >= 0 ? cols[iLoteId] : "",
          lote: iLote >= 0 ? cols[iLote] : "",
          custo_peca: iCustoPeca >= 0 ? cols[iCustoPeca] : "",
          markup: iMarkup >= 0 ? cols[iMarkup] : "",
          custos_extras: iExtras >= 0 ? cols[iExtras] : "",
        });
        if (erroCusto) {
          errors.push(`Linha ${li + 1}: ${erroCusto}`);
          continue;
        }

        let snapshotData: Record<string, unknown> = {};
        if (temOrigemCusto(custo)) {
          let loteFinal: string | null = custo.loteId;
          if (!loteFinal && custo.loteNome) {
            const chave = custo.loteNome.toLowerCase();
            const emCache = lotes.get(chave);
            if (emCache !== undefined) {
              loteFinal = emCache;
            } else {
              const lote = await prisma.loteCompra.findFirst({
                where: { nome: { equals: custo.loteNome, mode: "insensitive" } },
              });
              loteFinal = lote?.id ?? null;
              lotes.set(chave, loteFinal);
            }
          }
          const snap = await calcularSnapshot({
            loteId: loteFinal,
            custoPecaManualCentavos: custo.custoPecaCentavos,
            markupProduto: custo.markup,
            custosExtrasCentavos: custo.extrasCentavos,
            custosExtrasDescricao: null,
          });
          if (snap) {
            snapshotData = {
              lote_id: loteFinal,
              custo_peca_centavos: snap.custoPeca,
              custo_embalagem_centavos: snap.custoEmbalagem,
              custos_extras_centavos: snap.custosExtras,
              custos_extras_descricao: null,
              markup_percentual: custo.markup,
              preco_sugerido_centavos: snap.precoSugerido,
              precificacao_calculada_em: new Date(),
            };
          }
        }

        const criado = await prisma.product.create({
          data: {
            name,
            slug,
            description: (iDesc >= 0 && cols[iDesc]) || name,
            price,
            comparePrice: comparePrice && comparePrice > price ? comparePrice : null,
            stock,
            sku: (iSku >= 0 && cols[iSku]) || null,
            sizes,
            colors,
            categoryId,
            ...snapshotData,
          },
        });
        // Auditoria de preço (item 5): criação via import entra com
        // anterior = 0, documentando a origem do preço inicial.
        await registrarMudancaPreco(prisma, {
          produtoId: criado.id,
          usuarioId: session.sub,
          precoAnteriorCentavos: 0,
          precoNovoCentavos: reaisParaCentavos(price),
          origem: "import_csv",
        });
        created++;
        adicionarSemCusto(semCusto, name, Object.keys(snapshotData).length > 0);
      } catch (e) {
        errors.push(`Linha ${li + 1}: ${e instanceof Error ? e.message : "erro"}`);
      }
    }

    return NextResponse.json({ created, errors, semCusto });
  } catch (err) {
    console.error("[admin:produtos:import]", err);
    return NextResponse.json({ error: "Erro ao importar CSV" }, { status: 500 });
  }
}
