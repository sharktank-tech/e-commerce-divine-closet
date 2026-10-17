// Regras de endereço do cliente: troca atômica de "padrão" por usuário.
// Reutilizado por /api/enderecos (POST/PATCH) — fonte única dessas regras.

export type EnderecoRegistro = {
  id: string;
  userId: string | null;
  label: string;
  street: string;
  number: string;
  complement: string | null;
  neighborhood: string;
  city: string;
  state: string;
  zipCode: string;
  isDefault: boolean;
};

// Interface estrutural mínima: PrismaClient (e o cliente de transação, que
// não tem $transaction) e o fake dos testes servem.
export type DbEnderecos = {
  $transaction?<T>(fn: (tx: DbEnderecos) => Promise<T>): Promise<T>;
  user: { update(args: any): Promise<any> };
  address: {
    findFirst(args: any): Promise<any>;
    findUnique(args: any): Promise<any>;
    create(args: any): Promise<any>;
    update(args: any): Promise<any>;
    updateMany(args: any): Promise<any>;
    count(args: any): Promise<number>;
  };
};

// Torna `addressId` o único padrão do usuário (ou desfaz, com padrao=false).
// Atomicidade: uma transação única + lock na linha do usuário serializa
// trocas concorrentes — nunca restam dois padrões para a mesma conta.
export async function definirPadrao(
  tx: DbEnderecos,
  userId: string,
  addressId: string,
  padrao = true
): Promise<EnderecoRegistro> {
  await tx.user.update({ where: { id: userId }, data: { updatedAt: new Date() } });
  if (padrao) {
    await tx.address.updateMany({
      where: { userId, id: { not: addressId } },
      data: { isDefault: false },
    });
  }
  return tx.address.update({ where: { id: addressId }, data: { isDefault: padrao } });
}
