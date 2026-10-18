import { createHash, randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";

// Acompanhamento de pedido de CONVIDADO via link privado (/acompanhar/[token]).
// Segurança: no banco fica só o SHA-256 do token; o plaintext sai apenas no
// e-mail. Reenvio ROTACIONA o token (link antigo morre) com limite de envios
// e espera entre tentativas. A página pública nunca vaza dados pessoais.

export const ACOMPANHAMENTO_TTL_DIAS = 30;
export const REENVIO_ESPERA_MIN = 10;
export const REENVIO_MAX = 5;
export const REENVIO_MAX_PEDIDOS = 5;

type Db = Pick<typeof prisma, "order" | "orderTrackToken">;

type OrderTrackTokenRow = {
  orderId: string;
  tokenHash: string;
  sentTo: string | null;
  sendCount: number;
  lastSentAt: Date | null;
  expiresAt: Date;
  revokedAt: Date | null;
};

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function gerarToken(): string {
  return randomBytes(32).toString("base64url");
}

export function linkAcompanhamento(token: string): string {
  const base = (
    process.env.NEXT_PUBLIC_APP_URL || "https://www.divinecloset.com.br"
  ).replace(/\/$/, "");
  return `${base}/acompanhar/${token}`;
}

/** Formato esperado do plaintext (evita consultas inúteis ao banco). */
export function formatoTokenValido(token: string): boolean {
  return typeof token === "string" && /^[A-Za-z0-9_-]{32,128}$/.test(token);
}

export function tokenAtivo(row: OrderTrackTokenRow, agora = new Date()): boolean {
  return !row.revokedAt && row.expiresAt > agora;
}

export function emCooldown(row: OrderTrackTokenRow, agora = new Date()): boolean {
  if (row.sendCount >= REENVIO_MAX) return true;
  if (!row.lastSentAt) return false;
  return agora.getTime() - row.lastSentAt.getTime() < REENVIO_ESPERA_MIN * 60_000;
}

export type DadosPedidoPublicos = {
  number: string;
  status: string;
  paymentStatus: string;
  total: string;
  createdAt: Date;
  trackingCode: string | null;
  trackingCarrier: string | null;
  trackingUrl: string | null;
  items: Array<{ productName: string; quantity: number; size: string | null }>;
};

/**
 * Valida o token (hash, não revogado, não expirado) e devolve APENAS dados
 * públicos do pedido — sem nome, e-mail, telefone ou endereço.
 */
export async function buscarPedidoPorToken(
  token: unknown,
  db: Db = prisma
): Promise<DadosPedidoPublicos | null> {
  if (!formatoTokenValido(token as string)) return null;
  const row = (await db.orderTrackToken.findUnique({
    where: { tokenHash: hashToken(token as string) },
  })) as OrderTrackTokenRow | null;
  if (!row || !tokenAtivo(row)) return null;

  const order = await db.order.findUnique({
    where: { id: row.orderId },
    include: { items: { select: { productName: true, quantity: true, size: true } } },
  });
  if (!order) return null;

  return {
    number: order.number,
    status: order.status,
    paymentStatus: order.paymentStatus,
    total: String(order.total),
    createdAt: order.createdAt,
    trackingCode: order.trackingCode,
    trackingCarrier: order.trackingCarrier,
    trackingUrl: order.trackingUrl,
    items: order.items,
  };
}

/**
 * Cria (ou ROTACIONA) o token de acompanhamento de um pedido convidado.
 * Retorna o plaintext — guarde/envie imediatamente; depois só o hash existe.
 * A rotação SUBSTITUI o hash: o link antigo morre sozinho (é por isso que
 * `revokedAt` nunca é escrito hoje — revogação explícita sem rotação é
 * pendência de produto, não de segurança do link atual).
 */
export async function rotacionarToken(
  input: { orderId: string; sentTo?: string | null },
  db: Db = prisma
): Promise<string> {
  const token = gerarToken();
  const expiresAt = new Date(Date.now() + ACOMPANHAMENTO_TTL_DIAS * 86_400_000);
  const dados = {
    tokenHash: hashToken(token),
    sentTo: input.sentTo ?? null,
    expiresAt,
    revokedAt: null,
    lastSentAt: new Date(),
  };
  const existente = await db.orderTrackToken.findUnique({ where: { orderId: input.orderId } });
  if (existente) {
    await db.orderTrackToken.update({
      where: { orderId: input.orderId },
      data: { ...dados, sendCount: { increment: 1 } },
    });
  } else {
    await db.orderTrackToken.create({
      data: { orderId: input.orderId, sendCount: 1, ...dados },
    });
  }
  return token;
}

/** Token novo para o e-mail de confirmação (idempotente: só se não existe ativo). */
export async function criarTokenAcompanhamento(
  input: { orderId: string; sentTo?: string | null },
  db: Db = prisma
): Promise<string | null> {
  const existente = await db.orderTrackToken.findUnique({ where: { orderId: input.orderId } });
  const agora = new Date();
  if (existente && tokenAtivo(existente as OrderTrackTokenRow, agora)) {
    // já existe link ativo — o plaintext original só existe no e-mail antigo
    return null;
  }
  return rotacionarToken(input, db);
}

export type ResultadoReenvio = {
  /** Sempre true para o chamador — a resposta ao usuário é genérica. */
  aceito: boolean;
  enviou: boolean;
  links: Array<{ numero: string; url: string }>;
};

/**
 * Reenvio do link para o email do convidado.
 * Nunca confirma existência de pedidos (anti-enumeração) — quem chama deve
 * responder com a MESMA mensagem com ou sem resultados. Regras:
 * - qualquer token do email em limite/espera → não envia nada;
 * - no máximo REENVIO_MAX_PEDIDOS links por e-mail;
 * - rotação invalida os links anteriores.
 */
export async function processarReenvio(
  input: { email: string },
  db: Db = prisma
): Promise<ResultadoReenvio> {
  const email = input.email.trim().toLowerCase();
  const pedidos = (await db.order.findMany({
    where: { guestEmail: email, userId: null, deletedAt: null },
    orderBy: { createdAt: "desc" },
    take: REENVIO_MAX_PEDIDOS,
    include: { trackToken: true },
  })) as Array<{
    id: string;
    number: string;
    trackToken: OrderTrackTokenRow | null;
  }>;

  if (pedidos.length === 0) return { aceito: true, enviou: false, links: [] };

  const agora = new Date();
  if (pedidos.some((p) => p.trackToken && emCooldown(p.trackToken, agora))) {
    return { aceito: true, enviou: false, links: [] };
  }

  const links: Array<{ numero: string; url: string }> = [];
  for (const pedido of pedidos.slice(0, REENVIO_MAX_PEDIDOS)) {
    const token = await rotacionarToken(
      { orderId: pedido.id, sentTo: email },
      db
    );
    links.push({ numero: pedido.number, url: linkAcompanhamento(token) });
  }
  return { aceito: true, enviou: true, links };
}
