import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { PaymentError, processPayment } from "@/lib/pagamento";
import { finalizarPedidoPago } from "@/lib/pedidos/finalizar";
import { orderNumber, formatBRL } from "@/lib/utils";
import { reaisParaCentavos } from "@/lib/carrinho-revalidacao";
import {
  calcularPedido,
  calcularTotalCentavos,
  centavosParaReais,
} from "@/lib/pedidos/calculo-total";
import { elegibilidadeCupom } from "@/lib/elegibilidade-cupom";
import { getFrete, getPagamento } from "@/lib/config-loja";
import { enfileirarEvento, entregarEvento } from "@/lib/erp";
import {
  enfileirarEmailStatusPedido,
  processarEmailOutbox,
} from "@/lib/email-outbox";
import { obterCupom } from "@/lib/cupom-cache";
import { liberarCupomReservado, reservarCupom } from "@/lib/pedidos/cupom-reserva";
import { escolherCarrinho } from "@/lib/pedidos/selecionar-carrinho";
import { EnderecoInvalidoError, resolverEnderecoPedido } from "@/lib/pedidos/endereco-pedido";
import { comErro } from "@/lib/erros";
import { enderecoSchema, validarEmail, validarNome } from "@/lib/validacao";
import { cookies } from "next/headers";

/** Cupom sem vaga restante: 400 claro, antes de qualquer cobrança. */
class CupomEsgotadoError extends Error {
  constructor() {
    super("Cupom esgotado ou inativo");
    this.name = "CupomEsgotadoError";
  }
}

const checkoutSchema = z.object({
  address: enderecoSchema.extend({ label: z.string().optional() }),
  // Endereço já salvo na conta (checkout autenticado): o pedido reutiliza o
  // registro — sem criar cópia duplicada a cada compra. Dono verificado no servidor.
  addressId: z.string().nullish(),
  payment: z.object({
    method: z.enum(["card", "pix", "boleto"]).default("card"),
    card: z
      .object({
        number: z.string().optional(),
        name: z.string().optional(),
        expiry: z.string().optional(),
        cvv: z.string().optional(),
      })
      .optional(),
    // Checkout Transparente MP: token gerado no front (public key).
    cardToken: z.string().nullish(),
    installments: z.number().int().min(1).nullish(),
    paymentMethodId: z.string().nullish(),
  }),
  couponCode: z.string().nullish(),
  notes: z.string().nullish(),
  guest: z
    .object({
      email: z
        .string()
        .email("E-mail do convidado inválido")
        .refine((v) => validarEmail(v) === "OK", "E-mail do convidado inválido"),
      name: z
        .string()
        .min(2)
        .optional()
        .refine((v) => v == null || validarNome(v) === "OK", "Nome inválido"),
    })
    .optional(),
  utm: z
    .object({
      source: z.string().nullish(),
      medium: z.string().nullish(),
      campaign: z.string().nullish(),
    })
    .optional(),
  // Chave de idempotência do checkout: o front gera UMA por tentativa de
  // compra e a repete em todo retry. Aceita também no header `Idempotency-Key`
  // (padrão de APIs) — o header tem prioridade sobre o corpo.
  idempotencyKey: z.string().min(8).max(128).nullish(),
});

/**
 * Detecta P2002 do Prisma causado pelo índice único de idempotência do
 * checkout. O `meta.target` do erro lista a(s) coluna(s) violada(s); aceitamos
 * tanto o formato de array quanto o string simples que o Prisma emite conforme
 * a versão.
 */
function ehColisaoIdempotencia(err: unknown): boolean {
  const e = err as { code?: string; meta?: { target?: unknown } } | null;
  if (e?.code !== "P2002") return false;
  const alvo = e.meta?.target;
  const campos = Array.isArray(alvo) ? alvo.map(String) : alvo ? [String(alvo)] : [];
  return campos.some((c) => c.includes("idempotencyKey"));
}

type PedidoReplay = {
  id: string;
  number: string;
  status: string;
  paymentStatus: string;
  paymentId: string | null;
  idempotencyKey: string | null;
  couponCode: string | null;
  couponReserved: boolean;
  total: unknown;
};

/**
 * RETOMADA de pagamento num replay do checkout (revisão PR #16).
 *
 * Antes o replay devolvia o pedido já criado e seguia — se a tentativa
 * anterior tivesse sido interrompida ANTES (ou DURANTE) a chamada ao Mercado
 * Pago, o pedido ficava PENDING para sempre sem `paymentId`: sem QR para o
 * cliente, sem `paymentId` para o webhook (ele busca por id) e sem `paymentId`
 * para a reconciliação (filtro `paymentId != null`). Ninguém jamais o
 * recuperava.
 *
 * Agora o replay RETOMA a cobrança com a MESMA chave de idempotência do MP
 * (derivada do pedido persistido — nunca um UUID novo por chamada): se o
 * pagamento já existir no provedor, a API o devolve de volta em vez de criar
 * outro; se nunca chegou a ser criado, cria-se agora (o cliente ainda não
 * pagou). A gravação do `paymentId` é CONDICIONADA a `status=PENDING`, para
 * não sobrescrever uma finalização que já tenha acontecido pelo webhook.
 */
async function retomarPagamentoPendente(args: {
  pedido: PedidoReplay;
  pagamento: {
    method: string;
    card?: { number?: string; name?: string };
    cardToken?: string | null;
    installments?: number | null;
    paymentMethodId?: string | null;
  };
  payerEmail?: string;
}): Promise<NextResponse> {
  const { pedido, pagamento } = args;

  // Nada a retomar: pagamento já registrado, ou pedido fora de PENDING.
  if (pedido.paymentId || pedido.status !== "PENDING") {
    return NextResponse.json(
      { order: pedido, ok: true, replayed: true, pendente: pedido.paymentStatus === "PENDING" },
      { status: 200 }
    );
  }

  let result;
  try {
    result = await processPayment({
      orderId: pedido.id,
      amount: Number(pedido.total),
      method: pagamento.method || "card",
      card: pagamento.card,
      cardToken: pagamento.cardToken ?? undefined,
      installments: pagamento.installments ?? undefined,
      paymentMethodId: pagamento.paymentMethodId ?? undefined,
      payerEmail: args.payerEmail,
      // Chave derivada do PEDIDO persistido: o retry reenvia a mesma chave ao
      // MP e recebe o MESMO pagamento de volta (nunca uma segunda cobrança).
      idempotencyKey: pedido.idempotencyKey ?? undefined,
    });
  } catch (err) {
    // Falha de comunicação: o estado no provedor é DESCONHECIDO. Não se
    // cancela o pedido — pode ter sido cobrado. Deixa PENDING: a
    // reconciliação (por `external_reference`) recupera depois.
    const mensagem = err instanceof Error ? err.message : "Falha na comunicação com o gateway";
    console.error("[pedidos:replay-retomada]", pedido.id, mensagem);
    return NextResponse.json(
      {
        order: pedido,
        ok: false,
        replayed: true,
        pendente: true,
        error: mensagem,
        recupera: true,
      },
      { status: 502 }
    );
  }

  if (result.status === "PENDING") {
    await prisma.order.updateMany({
      where: { id: pedido.id, status: "PENDING" },
      data: { paymentId: result.paymentId },
    });
  } else if (result.success) {
    await finalizarPedidoPago(pedido.id, result.paymentId);
  } else {
    // Recusa definitiva: cancela (condicionado a PENDING) e devolve a vaga
    // do cupom reservada na criação.
    await prisma.$transaction(async (tx) => {
      const { count } = await tx.order.updateMany({
        where: { id: pedido.id, status: "PENDING" },
        data: { status: "CANCELLED", paymentStatus: "FAILED", paymentId: result.paymentId },
      });
      if (count === 1 && pedido.couponReserved && pedido.couponCode) {
        await liberarCupomReservado(tx, pedido.couponCode);
      }
    });
  }

  const finalOrder = await prisma.order.findUnique({ where: { id: pedido.id } });
  return NextResponse.json(
    {
      order: finalOrder ?? pedido,
      payment: result,
      ok: result.success,
      replayed: true,
      pendente: result.status === "PENDING",
      ...(result.success ? {} : { error: result.message }),
    },
    { status: result.success ? 200 : 402 }
  );
}

export async function GET(req: NextRequest) {
  try {
    const session = await getSession(req);
    if (!session) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

    const orders = await prisma.order.findMany({
      where: { userId: session.sub },
      include: { items: true, address: true },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ orders });
  } catch (err) {
    console.error("[pedidos:list]", err);
    return NextResponse.json({ error: "Erro ao carregar pedidos" }, { status: 500 });
  }
}

export const POST = comErro(async (req: NextRequest) => {
  try {
    // Compra como convidado é permitida: sessão opcional.
    const session = await getSession(req);

    const body = await req.json();
    const parsed = checkoutSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "Dados inválidos" },
        { status: 400 }
      );
    }

    if (!session && !parsed.data.guest?.email) {
      return NextResponse.json(
        { error: "Informe seu e-mail para continuar como convidado ou faça login" },
        { status: 401 }
      );
    }

    const guestEmail = session ? null : parsed.data.guest!.email;
    const guestName = session ? session.name : parsed.data.guest!.name || null;

    // Idempotência do checkout: header `Idempotency-Key` tem prioridade (padrão
    // de APIs) sobre o campo no corpo. Ausente nos dois = fluxo antigo (cada
    // requisição é um pedido novo); presente = retry devolve o MESMO pedido.
    const idempotencyKey =
      (req.headers.get("idempotency-key") || "").trim() ||
      parsed.data.idempotencyKey?.trim() ||
      null;
    if (idempotencyKey && idempotencyKey.length < 8) {
      return NextResponse.json(
        { error: "Idempotency-Key muito curta (mínimo 8 caracteres)" },
        { status: 400 }
      );
    }

    const guestId = req.cookies.get("dc_guest")?.value;
    const cartWhere: Array<{ userId?: string; guestId?: string }> = [];
    if (session) cartWhere.push({ userId: session.sub });
    if (guestId) cartWhere.push({ guestId });

    // Convidado + logado podem coexistir: busca todos e prefere o que
    // tem itens (findFirst puro devolvia o vazio → "Carrinho vazio" falso).
    const cart = cartWhere.length
      ? escolherCarrinho(
          await prisma.cart.findMany({
            where: { OR: cartWhere },
            include: {
              items: {
                include: {
                  product: {
                    select: {
                      id: true,
                      name: true,
                      slug: true,
                      price: true,
                      stock: true,
                      isActive: true,
                      // soft-delete: produto removido continua "isActive" no
                      // banco — sem este filtro entrava no pedido
                      deletedAt: true,
                      images: true,
                    },
                  },
                },
              },
            },
          })
        )
      : null;

    if (!cart || cart.items.length === 0) {
      return NextResponse.json({ error: "Carrinho vazio" }, { status: 400 });
    }

    // Revalidação final: preço/ disponibilidade podem ter mudado entre a
    // adição ao carrinho e o checkout. Nada é cobrado silenciosamente —
    // o cliente resolve no checkout (aceitar novo preço ou remover o item).
    const bloqueios: Array<{ itemId: string; name: string; motivo: string }> = [];
    for (const item of cart.items) {
      // soft-delete: produto removido pelo admin não pode ser comprado (o
      // filtro de listagem some com ele, mas um link antigo ainda chegava aqui)
      if (!item.product.isActive || item.product.deletedAt) {
        bloqueios.push({ itemId: item.id, name: item.product.name, motivo: "indisponivel" });
        continue;
      }
      if (reaisParaCentavos(item.unitPrice) !== reaisParaCentavos(item.product.price)) {
        bloqueios.push({ itemId: item.id, name: item.product.name, motivo: "preco" });
      }
    }
    if (bloqueios.length > 0) {
      return NextResponse.json(
        { error: "Revise os avisos do carrinho antes de finalizar", bloqueios },
        { status: 409 }
      );
    }

    // Estoque conferido contra a demanda AGREGADA por produto e por variação.
    // O carrinho permite duas linhas do mesmo produto em tamanhos diferentes
    // (chave única cartId+productId+size+color), então somar as linhas é
    // obrigatório: antes cada linha era conferida sozinha contra o saldo total
    // e um pedido 3+4 com saldo 5 passava na validação e estourava o estoque.
    const demandaProduto = new Map<string, { qtd: number; nome: string }>();
    for (const item of cart.items) {
      const atual = demandaProduto.get(item.product.id);
      if (atual) atual.qtd += item.quantity;
      else demandaProduto.set(item.product.id, { qtd: item.quantity, nome: item.product.name });
    }
    for (const [produtoId, { qtd, nome }] of demandaProduto) {
      const produto = cart.items.find((i) => i.product.id === produtoId)!.product;
      if (produto.stock < qtd) {
        return NextResponse.json(
          { error: `Estoque insuficiente para ${nome}` },
          { status: 409 }
        );
      }
    }

    // Variação (tamanho/cor): mesma agregação — duas linhas do mesmo tamanho
    // somam contra o saldo DAQUELA variação.
    const demandaVariacao = new Map<string, { qtd: number; nome: string; variacaoId: string }>();
    for (const item of cart.items) {
      const vars = await prisma.productVariation.findMany({
        where: { productId: item.product.id },
      });
      if (vars.length === 0) continue;
      const bySize = vars.filter((v) => v.size === item.size);
      const exact = bySize.find((v) => (v.color ?? null) === (item.color ?? null));
      const match = exact ?? (!item.color && bySize.length === 1 ? bySize[0] : undefined);
      if (!match) {
        return NextResponse.json(
          { error: `Combinação indisponível para ${item.product.name}` },
          { status: 409 }
        );
      }
      const atual = demandaVariacao.get(match.id);
      if (atual) atual.qtd += item.quantity;
      else
        demandaVariacao.set(match.id, {
          qtd: item.quantity,
          nome: item.product.name,
          variacaoId: match.id,
        });
    }
    if (demandaVariacao.size > 0) {
      const variacoes = await prisma.productVariation.findMany({
        where: { id: { in: [...demandaVariacao.keys()] } },
      });
      const porIdVar = new Map(variacoes.map((v) => [v.id, v]));
      for (const { qtd, nome, variacaoId } of demandaVariacao.values()) {
        if ((porIdVar.get(variacaoId)?.stock ?? 0) < qtd) {
          return NextResponse.json(
            { error: `Estoque insuficiente para ${nome}` },
            { status: 409 }
          );
        }
      }
    }

    const subtotal = cart.items.reduce(
      (s, i) => s + Number(i.product.price) * i.quantity,
      0
    );
    const subtotalCentavos = reaisParaCentavos(subtotal);

    const { address: addr, payment, notes, couponCode, utm } = parsed.data;
    const methodMap = { card: "CARD", pix: "PIX", boleto: "BOLETO" } as const;
    const paymentMethod = methodMap[payment.method] || "CARD";

    // Forma de pagamento precisa estar habilitada no painel.
    const formas = await getPagamento();
    const formaId = (payment.method || "card") as keyof typeof formas;
    if (!formas[formaId]) {
      return NextResponse.json({ error: "Forma de pagamento indisponível" }, { status: 400 });
    }
    // O driver Mercado Pago só cobre cartão e Pix — barra o boleto aqui
    // (400 claro) em vez de criar o pedido e falhar no gateway (500).
    if (process.env.PAYMENT_DRIVER === "mercadopago" && payment.method === "boleto") {
      return NextResponse.json(
        { error: "Boleto indisponível com Mercado Pago. Escolha cartão ou Pix." },
        { status: 400 }
      );
    }

    // Cupom — revalidado no servidor. Cálculo único em
    // lib/pedidos/calculo-total.ts — mesmo módulo que /api/cupom usa
    // para exibir, para gravado e exibido coincidirem até o centavo.
    const appliedCouponCode = couponCode?.trim().toUpperCase() || null;
    let cupomValido: { type: "PERCENT" | "FIXED" | "FREE_SHIPPING"; value: unknown } | null = null;

    if (appliedCouponCode) {
      const { cupom: coupon } = await obterCupom(appliedCouponCode);
      const now = new Date();
      // Mesma regra de /api/cupom (lib/elegibilidade-cupom.ts); aqui
      // qualquer motivo vira 400 com a mensagem única desta rota.
      const eleg = elegibilidadeCupom(coupon, now, subtotal);
      if (!coupon || !eleg.elegivel) {
        return NextResponse.json({ error: "Cupom inválido" }, { status: 400 });
      }
      cupomValido = { type: coupon.type, value: coupon.value };
    }

    const { descontoCentavos, freteCentavos } = calcularPedido(
      subtotalCentavos,
      cupomValido,
      await getFrete()
    );
    // TODO-CLIENTE: tabela de frete real da transportadora
    const discount = centavosParaReais(descontoCentavos);
    const shipping = centavosParaReais(freteCentavos);
    const total = centavosParaReais(
      calcularTotalCentavos(subtotalCentavos, descontoCentavos, freteCentavos)
    );

    // Criação atômica: endereço + pedido + itens nascem juntos ou nada nasce.
    let eventoCriadoId: string | null = null;
    let order;
    try {
      ({ order } = await prisma.$transaction(async (tx) => {
      // addressId: reutiliza endereço salvo da própria conta (sem duplicar).
      // ID de outra conta ou sem sessão → EnderecoInvalidoError (400 fora).
      const address = await resolverEnderecoPedido(tx, {
        session,
        addressId: parsed.data.addressId ?? null,
        dados: addr,
      });

      // RESERVA ATÔMICA DO CUPOM (revisão PR #16): consome a vaga ANTES de
      // criar o pedido e de qualquer cobrança, por UPDATE condicional no
      // banco. Sem vaga → aborta a transação inteira (o pedido não nasce) e a
      // rota responde 400; nada foi cobrado. `couponReserved` marca que o
      // contador já foi consumido por ESTE pedido (a finalização não repete).
      if (appliedCouponCode) {
        const reservado = await reservarCupom(tx, appliedCouponCode);
        if (!reservado) throw new CupomEsgotadoError();
      }

      const order = await tx.order.create({
        data: {
          number: orderNumber(),
        userId: session?.sub || null,
        guestEmail,
        guestName,
        addressId: address.id,
        status: "PENDING",
        paymentStatus: "PENDING",
        paymentMethod,
        // Mesma chave = mesmo pedido (índice único). O retry do cliente devolve
        // o pedido já existente em vez de criar outro — e, com ele, outra
        // cobrança. null = requisições sem o recurso de idempotência.
        ...(idempotencyKey ? { idempotencyKey } : {}),
        couponCode: appliedCouponCode,
        couponReserved: Boolean(appliedCouponCode),
        subtotal: centavosParaReais(subtotalCentavos),
        shipping,
        discount,
        total,
        notes: notes || null,
        utmSource: utm?.source || null,
        utmMedium: utm?.medium || null,
        utmCampaign: utm?.campaign || null,
        items: {
          create: cart.items.map((i) => ({
            productId: i.product.id,
            productName: i.product.name,
            productSlug: i.product.slug,
            imageUrl: i.product.images[0] || null,
            size: i.size,
            color: i.color,
            quantity: i.quantity,
            unitPrice: i.product.price,
            total: Number(i.product.price) * i.quantity,
          })),
        },
      },
      include: { items: true },
    });

      // Evento de criação na MESMA tx (pedido existe ⟺ evento existe);
      // businessKey por pedido — reprocesso não duplica.
      eventoCriadoId = await enfileirarEvento(
        "pedido_criado",
        {
          numero: order.number,
          total,
          subtotal: centavosParaReais(subtotalCentavos),
          desconto: discount,
          frete: shipping,
          cupom: appliedCouponCode,
          metodo_pagamento: paymentMethod,
          itens: cart.items.map((i) => ({
            produto_id: i.product.id,
            nome: i.product.name,
            qtd: i.quantity,
            preco_unit: Number(i.product.price),
          })),
        },
        { db: tx, businessKey: `pedido_criado:${order.id}` }
      );

      return { order };
      }));
    } catch (err) {
      // Retry do MESMO checkout: a chave de idempotência colidiu com o pedido
      // já criado por uma requisição anterior ou concorrente. Devolve o
      // pedido existente e NÃO cobra de novo — é exatamente o que a chave
      // de idempotência garante (índice único Order.idempotencyKey).
      if (idempotencyKey && ehColisaoIdempotencia(err)) {
        const existente = await prisma.order.findFirst({
          where: { idempotencyKey },
          select: {
            id: true,
            number: true,
            status: true,
            paymentStatus: true,
            paymentId: true,
            idempotencyKey: true,
            couponCode: true,
            couponReserved: true,
            total: true,
          },
        });
        if (existente) {
          // Replay: se a tentativa anterior foi interrompida antes de gravar
          // o pagamento, RETOMA a cobrança com a mesma chave do MP em vez de
          // devolver um pedido PENDING irrecuperável.
          return retomarPagamentoPendente({
            pedido: existente,
            pagamento: payment,
            payerEmail: session?.email || guestEmail || undefined,
          });
        }
      }
      throw err;
    }

    // ERP: entrega pós-commit, fire-and-forget (fila cuida das retentativas;
    // sem config fica PENDING até o dreno).
    if (eventoCriadoId) {
      void entregarEvento(eventoCriadoId).catch((err) =>
        console.error("[pedidos:erp]", err)
      );
    }

    let result;
    try {
      result = await processPayment({
        orderId: order.id,
        amount: total,
        method: payment.method || "card",
        card: payment.card,
        cardToken: payment.cardToken ?? undefined,
        installments: payment.installments ?? undefined,
        paymentMethodId: payment.paymentMethodId ?? undefined,
        payerEmail: session?.email || guestEmail || undefined,
        // Retry da MESMA tentativa reusa a chave no MP: o header
        // X-Idempotency-Key impede uma segunda cobrança pelo mesmo checkout.
        idempotencyKey: idempotencyKey ?? undefined,
      });
    } catch (err) {
      // Estado DESCONHECIDO no provedor (timeout, rede, 5xx): o pagamento
      // PODE ter sido criado. Cancelar o pedido aqui transformaria um possível
      // pagamento aprovado em pedido morto — o webhook e a reconciliação só
      // enxergam pedidos PENDING, então o dinheiro ficaria tomado sem pedido.
      // O pedido permanece PENDING: a reconciliação o recupera pela
      // `external_reference` (o próprio orderId) no `/v1/payments/search`.
      // O carrinho NÃO é esvaziado (o cliente pode tentar de novo; o replay
      // retoma com a mesma chave de idempotência do MP).
      console.error(
        "[pedidos:gateway-incerto]",
        order.id,
        err instanceof Error ? err.message : String(err)
      );
      if (err instanceof PaymentError) {
        return NextResponse.json(
          { error: err.message, orderId: order.id, recupera: true },
          { status: 502 }
        );
      }
      throw err;
    }

    if (result.status === "PENDING") {
      // Pix/cartão em análise: pedido continua PENDING com o id do pagamento;
      // a confirmação (baixa de estoque, cupom, e-mail) chega no webhook.
      // Condicional a `status=PENDING`: se o webhook já tiver finalizado o
      // pedido (corrida), gravar o paymentId por cima não pode reabrir nada.
      await prisma.order.updateMany({
        where: { id: order.id, status: "PENDING" },
        data: { paymentId: result.paymentId },
      });
    } else if (result.success) {
      await finalizarPedidoPago(order.id, result.paymentId);
    } else {
      // Cancelamento (pagamento recusado): evento ERP + e-mail na MESMA
      // transação (dedupeKey única); envio pós-commit com retentativa.
      // A vaga do cupom reservada na criação é DEVOLVIDA aqui — recusa
      // definitiva não deve consumir limite comercial.
      const { eventoId: eventoCancelId, emailId } = await prisma.$transaction(async (tx) => {
        await tx.order.update({
          where: { id: order.id },
          data: {
            status: "CANCELLED",
            paymentStatus: "FAILED",
            paymentId: result.paymentId,
          },
        });
        if (appliedCouponCode && order.couponReserved) {
          await liberarCupomReservado(tx, appliedCouponCode);
        }
        const eventoId = await enfileirarEvento(
          "pedido_cancelado",
          { numero: order.number, motivo: result.message },
          { db: tx, businessKey: `pedido_cancelado:${order.id}` }
        );
        const emailId = await enfileirarEmailStatusPedido(
          order.id,
          "CANCELLED",
          tx as Parameters<typeof enfileirarEmailStatusPedido>[2]
        );
        return { eventoId, emailId };
      });
      if (eventoCancelId) {
        void entregarEvento(eventoCancelId).catch((err) =>
          console.error("[pedidos:erp]", err)
        );
      }
      if (emailId) {
        void processarEmailOutbox(emailId).catch((err) =>
          console.error("[pedidos:cancel-email]", err)
        );
      }
    }

    await prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
    const store = await cookies();
    store.delete("dc_guest");

    const finalOrder = await prisma.order.findUnique({
      where: { id: order.id },
      include: { items: true, address: true },
    });

    if (result.success) {
      return NextResponse.json(
        {
          order: finalOrder,
          payment: result,
          ok: true,
          pendente: result.status === "PENDING",
        },
        { status: 201 }
      );
    }

    return NextResponse.json(
      { order: finalOrder, payment: result, ok: false, error: result.message },
      { status: 402 }
    );
  } catch (err) {
    console.error("[pedidos:create]", err);
    // addressId de outra conta / sem sessão: 400 claro (não vaza existência).
    if (err instanceof EnderecoInvalidoError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    // Cupom sem vaga na RESERVA (tx abortada antes de criar o pedido):
    // 400 claro, nada foi cobrado.
    if (err instanceof CupomEsgotadoError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    // Perdeu a corrida pelo último item: 409 claro em vez de 500 genérico.
    if (err instanceof Error && err.message.startsWith("Estoque insuficiente")) {
      return NextResponse.json({ error: "Estoque insuficiente para um ou mais itens" }, { status: 409 });
    }
    // Erro do gateway real: 502 com a mensagem acionável (sem stack).
    if (err instanceof PaymentError) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    return NextResponse.json({ error: "Erro ao finalizar pedido" }, { status: 500 });
  }
}, { rota: "pedidos" });
