// Auditoria de preço (tabela historico_preco).
//
// Uma linha por mudança de Product.price, com quem/quando/de/para/origem:
// edicao_manual (formulário admin), recalculo_massa (aplicar sugerido),
// import_csv (criação via import, com anterior = 0).
// Sem mudança (anterior == novo) não gera linha.

export type OrigemPreco = "edicao_manual" | "recalculo_massa" | "import_csv";

type BancoHistorico = {
  historicoPreco: {
    create(args: {
      data: {
        produto_id: string;
        usuario_id: string | null;
        preco_anterior_centavos: number;
        preco_novo_centavos: number;
        origem: OrigemPreco;
      };
    }): Promise<unknown>;
  };
};

export async function registrarMudancaPreco(
  db: BancoHistorico,
  args: {
    produtoId: string;
    usuarioId: string | null;
    precoAnteriorCentavos: number;
    precoNovoCentavos: number;
    origem: OrigemPreco;
  }
): Promise<boolean> {
  if (args.precoAnteriorCentavos === args.precoNovoCentavos) return false;
  await db.historicoPreco.create({
    data: {
      produto_id: args.produtoId,
      usuario_id: args.usuarioId,
      preco_anterior_centavos: args.precoAnteriorCentavos,
      preco_novo_centavos: args.precoNovoCentavos,
      origem: args.origem,
    },
  });
  return true;
}
