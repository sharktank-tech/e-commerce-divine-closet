import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, forbidden } from "@/lib/auth";

// Configurações gerais editáveis pelo painel (seção 4.8).
// Valores armazenados como JSON string na tabela Setting.
// TODO-CLIENTE: dados reais da empresa, regras de frete, formas de pagamento.

const DEFAULTS: Record<string, unknown> = {
  empresa: {
    name: "Divine Closet",
    cnpj: "",
    email: "contato@divinecloset.com",
    phone: "(11) 3000-0000",
    address: "",
    logoUrl: "",
  },
  pixels: { metaPixelId: "", googleAdsId: "", ga4Id: "" },
  frete: { fixed: 20, freeFrom: 300, prazoDias: "5-10" },
  pagamento: { card: true, pix: true, boleto: true },
  emailMarketing: { provider: "", senderName: "Divine Closet", senderEmail: "" },
};

export async function GET() {
  try {
    const session = await requireAuth("ADMIN");
    if (!session) return forbidden();

    const rows = await prisma.setting.findMany();
    const stored = Object.fromEntries(
      rows.map((r) => {
        try {
          return [r.key, JSON.parse(r.value)];
        } catch {
          return [r.key, r.value];
        }
      })
    );

    return NextResponse.json({ settings: { ...DEFAULTS, ...stored } });
  } catch (err) {
    console.error("[admin:config:get]", err);
    return NextResponse.json({ error: "Erro ao carregar configurações" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const session = await requireAuth("ADMIN");
    if (!session) return forbidden();

    const body = await req.json();
    const entries = Object.entries(body || {}).filter(([k]) => k in DEFAULTS);
    if (entries.length === 0) {
      return NextResponse.json({ error: "Nada para salvar" }, { status: 400 });
    }

    await prisma.$transaction(
      entries.map(([key, value]) =>
        prisma.setting.upsert({
          where: { key },
          update: { value: JSON.stringify(value) },
          create: { key, value: JSON.stringify(value) },
        })
      )
    );

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[admin:config:put]", err);
    return NextResponse.json({ error: "Erro ao salvar configurações" }, { status: 500 });
  }
}
