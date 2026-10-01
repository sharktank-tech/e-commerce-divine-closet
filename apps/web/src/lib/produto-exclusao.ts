// Exclusão de produto com histórico preservado.
//
// O FK OrderItem → Product é Restrict: hard delete de um produto que já foi
// vendido falha no banco. Por isso a exclusão passa por esta decisão:
// - com pedidos associados → desativa (isActive=false, deletedAt), o produto
//   some da loja mas continua visível nos pedidos antigos (snapshot);
// - sem pedidos → hard delete liberado.

export type ModoExclusao = "desativar" | "excluir";

export function modoExclusaoProduto(totalPedidos: number): ModoExclusao {
  return totalPedidos > 0 ? "desativar" : "excluir";
}

type BancoExclusao = {
  orderItem: {
    count(args: { where: { productId: string } }): Promise<number>;
  };
  product: {
    update(args: {
      where: { id: string };
      data: { deletedAt: Date; isActive: boolean };
    }): Promise<unknown>;
    delete(args: { where: { id: string } }): Promise<unknown>;
  };
};

export async function aplicarExclusaoProduto(
  db: BancoExclusao,
  id: string
): Promise<ModoExclusao> {
  const totalPedidos = await db.orderItem.count({ where: { productId: id } });
  if (modoExclusaoProduto(totalPedidos) === "desativar") {
    await db.product.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
    return "desativar";
  }
  await db.product.delete({ where: { id } });
  return "excluir";
}
