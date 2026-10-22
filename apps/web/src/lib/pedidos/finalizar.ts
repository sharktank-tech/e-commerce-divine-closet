import { prisma } from "@/lib/prisma";
import { emails } from "@/lib/email";
import { invalidarCupom } from "@/lib/cupom-cache";
import { type DbErp, entregarEvento, enfileirarEvento } from "@/lib/erp";
import { montarLinkAcompanhamento } from "@/lib/pedidos/notificar-status";
import { dedupeKeyStatusPedido, enfileirarEmail, processarEmailOutbox } from "@/lib/email-outbox";

// Pós-aprovação do pedido — caminho único para confirmação síncrona
// (mock/cartão aprovado na hora) e assíncrona (Pix/cartão in_process via
// webhook do MP).
//
// CORREÇÕES DE INTEGRIDADE (diagnóstico PR #15, defeitos #3 e #4):
//
//  1. A guarda de transição é AUTORITATIVA dentro da transação. Antes a
//     leitura `paymentStatus !== "PENDING"` era feita FORA da tx e o update
//     dentro dela era incondicional: dois webhooks simultâneos liam PENDING,
//     ambos passavam e ambos baixavam estoque/cupom/e-mail. Agora a linha do
//     pedido é travada (FOR UPDATE) e recarregada dentro da tx — quem perde a
//     corrida enxerga o estado já liquidado e sai sem escrever nada.
//
//  2. A demanda de estoque é AGREGADA por produto e por variação. Antes cada
//     OrderItem era conferido separadamente contra o saldo total, então um
//     pedido com duas linhas do mesmo produto (3 + 4 com saldo 5) passava nas
//     duas conferências e deixava o estoque em -2.
//
//  3. Variações também são travadas (antes só Product), e o cupom passa por
//     trava + checagem de `maxUses` antes do incremento (antes incrementava
//     incondicionalmente, podendo ultrapassar o limite).
//
// Eventos ERP (`pedido_pago` com businessKey + `estoque_atualizado`) são
// GRAVADOS na MESMA tx da transição; I/O externo (e-mail, entrega do webhook
// ERP) fica fora da tx, após o commit.

type ItemPedido = {
  quantity: number;
  size: string | null;
  color: string | null;
  productName: string;
  unitPrice: unknown;
  product: { id: string };
};

type BancoFinalizar = {
  $transaction(fn: (tx: TxFinalizar) => Promise<unknown>): Promise<unknown>;
  // opcional: fakes de teste podem omitir (link de convidado é best-effort)
  orderTrackToken?: {
    findUnique(args: unknown): Promise<{
      tokenHash: string;
      expiresAt: Date;
      revokedAt: Date | null;
    } | null>;
    create(args: unknown): Promise<unknown>;
    update(args: unknown): Promise<unknown>;
  };

  order: {
    findUnique(args: unknown): Promise<{
      id: string;
      number: string;
      paymentStatus: string;
      userId: string | null;
      guestEmail: string | null;
      couponCode: string | null;
      total: unknown;
      paymentMethod: string;
      user: { email: string } | null;
      items: ItemPedido[];
    } | null>;
  };
};

type TxFinalizar = {
  $queryRawUnsafe(query: string, ...valores: unknown[]): Promise<unknown>;
  order: {
    // reload autoritativo DENTRO da tx, após travar a linha do pedido
    findUnique(args: unknown): Promise<{
      id: string;
      number: string;
      paymentStatus: string;
      userId: string | null;
      guestEmail: string | null;
      couponCode: string | null;
      total: unknown;
      paymentMethod: string;
      user: { email: string } | null;
      items: ItemPedido[];
    } | null>;
    update(args: unknown): Promise<unknown>;
  };
  coupon: {
    findUnique(args: unknown): Promise<{ code: string; maxUses: number | null; usedCount: number } | null>;
    update(args: unknown): Promise<unknown>;
  };
  product: {
    findMany(args: unknown): Promise<
      Array<{
        id: string;
        stock: number;
        variations: Array<{ id: string; size: string; color: string | null; stock: number }>;
      }>
    >;
    update(args: unknown): Promise<unknown>;
  };
  productVariation: {
    update(args: unknown): Promise<unknown>;
  };
  // Opcional: fakes de teste podem omitir — sem modelo não há fila a
  // gravar (transição de negócio segue; evento é melhor-esforço no fake).
  erpEvent?: {
    create(args: unknown): Promise<unknown>;
    findUnique(args: unknown): Promise<{ id: string } | null>;
  };
};

/** Localiza a variação que atende um item (mesma regra do checkout). */
function localizarVariacao(
  variacoes: Array<{ id: string; size: string; color: string | null; stock: number }>,
  item: ItemPedido
) {
  const bySize = variacoes.filter((v) => v.size === item.size);
  return (
    bySize.find((v) => (v.color ?? null) === (item.color ?? null)) ??
    (!item.color && bySize.length === 1 ? bySize[0] : undefined)
  );
}

export async function finalizarPedidoPago(
  orderId: string,
  paymentId?: string,
  db: BancoFinalizar = prisma as unknown as BancoFinalizar
): Promise<{ ok: boolean; jaFinalizado: boolean }> {
  // Fast-path de leitura: evita abrir transação quando o pedido já está
  // liquidado (reenvio de webhook). É SÓ otimização — a autoridade é a trava +
  // recarga dentro da tx, porque esta leitura pode estar defasada em corrida.
  const order = await db.order.findUnique({
    where: { id: orderId },
    include: {
      items: { include: { product: { select: { id: true } } } },
      user: { select: { email: true } },
    },
  });
  if (!order) return { ok: false, jaFinalizado: false };
  if (order.paymentStatus !== "PENDING") return { ok: true, jaFinalizado: true };

  const estoquesNovos = new Map<string, number>();
  const eventosErp: string[] = [];
  let jaFinalizadoDentroDaTx = false;

  await db.$transaction(async (tx) => {
    // 1) Trava a linha do PEDIDO primeiro: serializa webhook, reconciliação e
    //    caminho síncrono concorrentes do mesmo pedido. Quem espera a trava
    //    enxerga o estado já liquidado no passo 2 e sai sem escrever.
    await tx.$queryRawUnsafe(
      `SELECT id FROM "Order" WHERE id = $1::uuid FOR UPDATE`,
      orderId
    );

    // 2) Recarrega o pedido COM os itens dentro da tx — estado autoritativo.
    const atual = await tx.order.findUnique({
      where: { id: orderId },
      include: {
        items: { include: { product: { select: { id: true } } } },
        user: { select: { email: true } },
      },
    });
    if (!atual || atual.paymentStatus !== "PENDING") {
      jaFinalizadoDentroDaTx = true;
      return;
    }

    // 3) Trava produtos e variações em ordem DETERMINÍSTICA (id crescente) para
    //    dois checkouts concorrentes nunca provocarem deadlock entre si.
    const ids = [...new Set(atual.items.map((i) => i.product.id))].sort();
    if (ids.length > 0) {
      await tx.$queryRawUnsafe(
        `SELECT id FROM "Product" WHERE id IN (${ids.map((_, k) => `$${k + 1}::uuid`).join(",")}) ORDER BY id FOR UPDATE`,
        ...ids
      );
      await tx.$queryRawUnsafe(
        `SELECT id FROM "ProductVariation" WHERE "productId" IN (${ids.map((_, k) => `$${k + 1}::uuid`).join(",")}) ORDER BY id FOR UPDATE`,
        ...ids
      );
    }
    const produtos = await tx.product.findMany({
      where: { id: { in: ids } },
      include: { variations: true },
    });
    const porId = new Map(produtos.map((p) => [p.id, p]));

    // 4) Agrega a demanda ANTES de conferir: duas linhas do mesmo produto
    //    somam, e cada variação é conferida contra o saldo DAQUELA variação.
    const demandaProduto = new Map<string, number>();
    const demandaVariacao = new Map<string, number>();
    for (const item of atual.items) {
      const produtoId = item.product.id;
      demandaProduto.set(produtoId, (demandaProduto.get(produtoId) ?? 0) + item.quantity);
      const prod = porId.get(produtoId);
      if (prod && prod.variations.length > 0) {
        const match = localizarVariacao(prod.variations, item);
        if (!match) {
          throw new Error("Estoque insuficiente na finalização (variação)");
        }
        demandaVariacao.set(match.id, (demandaVariacao.get(match.id) ?? 0) + item.quantity);
      }
    }

    // 5) Confere o saldo AGREGADO de cada produto e de cada variação.
    for (const [produtoId, demanda] of demandaProduto) {
      const prod = porId.get(produtoId);
      if (!prod || prod.stock < demanda) {
        throw new Error("Estoque insuficiente na finalização");
      }
    }
    for (const [variacaoId, demanda] of demandaVariacao) {
      const variacao = produtos
        .flatMap((p) => p.variations)
        .find((v) => v.id === variacaoId);
      if (!variacao || variacao.stock < demanda) {
        throw new Error("Estoque insuficiente na finalização (variação)");
      }
    }

    // 6) Transição PENDING → PAID. Já segura a trava do pedido, então o update
    //    incondicional aqui é seguro: nenhum outro fluxo consegue intervir.
    await tx.order.update({
      where: { id: atual.id },
      data: {
        status: "PAID",
        paymentStatus: "PAID",
        ...(paymentId ? { paymentId } : {}),
      },
    });

    // 7) Cupom: trava a linha, recarrega e só incrementa se ainda houver vaga.
    //    `usedCount` nunca ultrapassa `maxUses`. Se a vaga esgotou (outro
    //    pedido concorrente consumiu a última), NÃO se aborta a confirmação:
    //    o pagamento já foi irreversível no provedor — deixar o pedido pago
    //    pendurado para sempre seria pior que o contador. Alerta explícito.
    if (atual.couponCode) {
      await tx.$queryRawUnsafe(
        `SELECT id FROM "Coupon" WHERE code = $1 FOR UPDATE`,
        atual.couponCode
      );
      const cupom = await tx.coupon.findUnique({ where: { code: atual.couponCode } });
      if (cupom && cupom.maxUses != null && cupom.usedCount >= cupom.maxUses) {
        console.error(
          "[finalizar:cupom-esgotado]",
          atual.couponCode,
          `pedido=${atual.id} usedCount=${cupom.usedCount} maxUses=${cupom.maxUses}`
        );
      } else {
        await tx.coupon.update({
          where: { code: atual.couponCode },
          data: { usedCount: { increment: 1 } },
        });
      }
      invalidarCupom(atual.couponCode);
    }

    // 8) Baixa AGREGADA de estoque (uma escrita por produto/variação, não uma
    //    por linha do pedido). O saldo nunca fica negativo: o passo 5 já
    //    conferiu a demanda total contra o saldo travado.
    for (const [produtoId, demanda] of demandaProduto) {
      await tx.product.update({
        where: { id: produtoId },
        data: { stock: { decrement: demanda } },
      });
      const prod = porId.get(produtoId);
      estoquesNovos.set(produtoId, Math.max(0, (prod?.stock ?? 0) - demanda));
    }
    for (const [variacaoId, demanda] of demandaVariacao) {
      await tx.productVariation.update({
        where: { id: variacaoId },
        data: { stock: { decrement: demanda } },
      });
    }

    // Eventos ERP na MESMA transição da baixa: `pedido_pago` (venda
    // confirmada — só em PAID real, nunca em pedido apenas criado) com
    // businessKey única por pedido; estoque atualizado junto do decremento.
    // Erro de fila aqui derruba a tx inteira (transição sem evento = não):
    // webhook/reconciliação reprocessam a confirmação.
    if (tx.erpEvent) {
      const erpDb = tx as unknown as DbErp;
      const pagoId = await enfileirarEvento(
        "pedido_pago",
        {
          numero: atual.number,
          total: Number(String(atual.total)),
          metodo_pagamento: atual.paymentMethod,
          cupom: atual.couponCode,
          itens: atual.items.map((i) => ({
            produto_id: i.product.id,
            nome: i.productName,
            qtd: i.quantity,
            preco_unit: Number(String(i.unitPrice)),
          })),
        },
        { db: erpDb, businessKey: `pedido_pago:${atual.id}` }
      );
      if (pagoId) eventosErp.push(pagoId);
      for (const [produto_id, estoque] of estoquesNovos) {
        const eid = await enfileirarEvento(
          "estoque_atualizado",
          { produto_id, estoque },
          { db: erpDb }
        );
        if (eid) eventosErp.push(eid);
      }
    }
  });

  // Corrida perdida: outro fluxo já confirmou este pedido dentro da tx — nada
  // foi escrito por nós, então não há e-mail nem evento a disparar.
  if (jaFinalizadoDentroDaTx) return { ok: true, jaFinalizado: true };

  // Pós-commit: entrega imediata (sem travar); sem config ERP a fila
  // fica PENDING e o dreno do cron entrega depois.
  for (const eventoId of eventosErp) {
    void entregarEvento(eventoId).catch((err) =>
      console.error("[finalizar:erp]", eventoId, err)
    );
  }

  // Link de acompanhamento no e-mail de confirmação: logado → /conta;
  // convidado → link privado novo (só se não existe token ativo).
  // Best-effort: falha de link nunca derruba a finalização.
  let linkAcompanhar: string | null = null;
  try {
    const { link } = await montarLinkAcompanhamento(
      { id: order.id, userId: order.userId ?? null, guestEmail: order.guestEmail },
      db as unknown as Parameters<typeof montarLinkAcompanhamento>[1]
    );
    linkAcompanhar = link;
  } catch (err) {
    console.error("[finalizar:link-acompanhar]", err);
  }

  // E-mail "pedido pago" via OUTBOX (antes: sendEmail direto — perdia a
  // mensagem se falhasse e podia duplicar em webhook repetido/concorrente).
  // A dedupeKey única (status:{orderId}:PAID) garante NO MÁXIMO UMA linha por
  // pedido: repetição PENDING→PAID não re-enfileira (a guarda de transição já
  // retorna cedo) e, mesmo que enfileirasse, o P2002 devolve a linha existente
  // → nenhum segundo envio. Fire-and-forget: não trava a finalização; falha
  // fica PENDING e o dreno dos crons (12:00/21:00 UTC = 09h/18h local) retenta
  // com backoff.
  const mail = emails.orderPaid(order.number, linkAcompanhar);
  void (async () => {
    try {
      const outboxId = await enfileirarEmail({
        dedupeKey: dedupeKeyStatusPedido(order.id, "PAID"),
        kind: "order_paid",
        orderId: order.id,
        mail: {
          to: order.user?.email || order.guestEmail || "",
          subject: mail.subject,
          text: mail.text,
        },
      });
      if (outboxId) await processarEmailOutbox(outboxId);
    } catch (err) {
      console.error("[finalizar:email]", err);
    }
  })();

  return { ok: true, jaFinalizado: false };
}
