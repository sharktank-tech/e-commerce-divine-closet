// Reserva ATÔMICA de cupom na criação do pedido (revisão PR #16).
//
// O problema: a contagem de uso (`Coupon.usedCount`) era incrementada na
// FINALIZAÇÃO, depois da cobrança. Entre a criação e a finalização outras
// checkouts liam o mesmo `usedCount` e passavam na checagem de `maxUses`, e
// o desconto era concedido acima do limite comercial (o incremento condicional
// da finalização só evitava o estouro do CONTADOR, não o desconto já cobrado).
//
// A correção move a consumição para a criação, DENTRO da mesma transação que
// cria o pedido, por UPDATE condicional com RETURNING: o banco é quem decide
// se ainda havia vaga — nenhuma corrida de leitura-then-write passa por cima
// de `maxUses`. Se não houve vaga, o pedido nem nasce (400) e nada é cobrado.
//
// A liberação (decremento com piso 0) só acontece em desfecho DEFINITIVO de
// falha (pagamento recusado/expirado → CANCELLED). Enquanto o pagamento pode
// ainda aprovar (PENDING), a reserva permanece — soltar cedo reabriria a
// janela do estouro.

/** Transação crua o suficiente para o SQL condicional (Prisma tx ou fake). */
type TxSql = {
  $queryRawUnsafe<T = unknown>(query: string, ...valores: unknown[]): Promise<T>;
};

/**
 * Consome UMA vaga do cupom (se houver) e devolve true. `false` = cupom
 * esgotado/inativo/inexistente — o chamador aborta o checkout com 400 antes
 * de qualquer cobrança. O incremento e o `updatedAt` (coluna NOT NULL) são
 * gravados na MESMA linha travada pelo banco.
 */
export async function reservarCupom(tx: TxSql, code: string): Promise<boolean> {
  const linhas = await tx.$queryRawUnsafe<unknown[]>(
    `UPDATE "Coupon"
        SET "usedCount" = "usedCount" + 1, "updatedAt" = now()
      WHERE "code" = $1
        AND "deletedAt" IS NULL
        AND "active" = true
        AND ("maxUses" IS NULL OR "usedCount" < "maxUses")
      RETURNING "code"`,
    code
  );
  return Array.isArray(linhas) && linhas.length > 0;
}

/**
 * Devolve UMA vaga ao cupom (piso 0, nunca negativo). Chamado quando um
 * pedido que JÁ reservou o cupom termina em falha definitiva.
 */
export async function liberarCupomReservado(tx: TxSql, orderId: string): Promise<void> {
  // A posse da reserva é consumida atomicamente. Repetição não toca reservas alheias.
  await tx.$queryRawUnsafe(
    `WITH liberado AS (
       UPDATE "Order" SET "couponReserved" = false, "updatedAt" = now()
       WHERE id = $1::uuid AND "couponReserved" = true
         AND status = 'CANCELLED' AND "paymentStatus" = 'FAILED'
       RETURNING "couponCode"
     )
     UPDATE "Coupon" SET "usedCount" = GREATEST("usedCount" - 1, 0), "updatedAt" = now()
     WHERE code IN (SELECT "couponCode" FROM liberado)`,
    orderId
  );
}
