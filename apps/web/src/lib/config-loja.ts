import { prisma } from "./prisma";

// Leitura das configurações do painel na loja (server-side).
// Mesmos DEFAULTS da rota admin; o que está gravado em Setting vence.
// Usado direto no servidor; o cliente consome via GET /api/config-loja.

export type EmpresaConfig = {
  name: string;
  cnpj: string;
  email: string;
  phone: string;
  whatsapp: string;
  address: string;
  logoUrl: string;
};

export type FreteConfig = {
  fixed: number;
  freeFrom: number;
  prazoDias: string;
};

export type PagamentoConfig = {
  card: boolean;
  pix: boolean;
  boleto: boolean;
};

const EMPRESA_PADRAO: EmpresaConfig = {
  name: "Divine Closet",
  cnpj: "",
  email: "contato@divinecloset.com",
  phone: "(11) 3000-0000",
  whatsapp: "",
  address: "",
  logoUrl: "",
};

const FRETE_PADRAO: FreteConfig = {
  fixed: 20,
  freeFrom: 300,
  prazoDias: "5-10",
};

const PAGAMENTO_PADRAO: PagamentoConfig = {
  card: true,
  pix: true,
  boleto: true,
};

type BancoConfig = {
  setting: {
    findUnique(args: unknown): Promise<{ value: string } | null>;
  };
};

async function ler<T extends Record<string, unknown>>(
  db: BancoConfig,
  chave: string,
  padrao: T
): Promise<T> {
  try {
    const linha = await db.setting.findUnique({ where: { key: chave } });
    if (!linha) return padrao;
    const gravado = JSON.parse(linha.value) as Partial<T>;
    if (!gravado || typeof gravado !== "object") return padrao;
    return { ...padrao, ...gravado };
  } catch {
    return padrao;
  }
}

export async function getEmpresa(
  db: BancoConfig = prisma
): Promise<EmpresaConfig> {
  return ler(db, "empresa", EMPRESA_PADRAO);
}

export async function getFrete(
  db: BancoConfig = prisma
): Promise<FreteConfig> {
  return ler(db, "frete", FRETE_PADRAO);
}

export async function getPagamento(
  db: BancoConfig = prisma
): Promise<PagamentoConfig> {
  return ler(db, "pagamento", PAGAMENTO_PADRAO);
}
