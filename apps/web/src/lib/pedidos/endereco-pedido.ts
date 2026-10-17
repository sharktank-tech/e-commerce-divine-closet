import type { Address } from "@prisma/client";

// Resolve o endereço de um pedido: reutiliza registro salvo (addressId) ou
// cria inline (visitante / sem id). O dono é verificado aqui — um id de
// outra conta nunca é usado (critério: isolamento entre contas).

export class EnderecoInvalidoError extends Error {
  constructor(message = "Endereço inválido") {
    super(message);
    this.name = "EnderecoInvalidoError";
  }
}

type SessaoPedido = { sub: string } | null;

type DadosEnderecoPedido = {
  street: string;
  number: string;
  complement?: string | null;
  neighborhood: string;
  city: string;
  state: string;
  zipCode: string;
  label?: string;
};

type TxEndereco = {
  address: {
    findUnique(args: any): Promise<Address | null>;
    create(args: any): Promise<Address>;
  };
};

export async function resolverEnderecoPedido(
  tx: TxEndereco,
  args: { session: SessaoPedido; addressId: string | null; dados: DadosEnderecoPedido }
): Promise<Address> {
  const { session, addressId, dados } = args;

  if (addressId) {
    // Sem sessão não há endereço "próprio" possível → recusa.
    if (!session) throw new EnderecoInvalidoError("Endereço inválido");
    const salvo = await tx.address.findUnique({ where: { id: addressId } });
    // 400 idêntico para "não existe" e "é de outra conta" (sem vazamento).
    if (!salvo || salvo.userId !== session.sub) {
      throw new EnderecoInvalidoError("Endereço inválido");
    }
    return salvo;
  }

  return tx.address.create({
    data: {
      userId: session?.sub || null,
      label: dados.label || "Principal",
      street: dados.street,
      number: dados.number,
      complement: dados.complement || null,
      neighborhood: dados.neighborhood,
      city: dados.city,
      state: dados.state.toUpperCase(),
      zipCode: dados.zipCode,
    },
  });
}
