// Regras puras do passo de endereço/frete do checkout — testáveis sem UI.
// (Sessão = escolha da compra atual; estado = servidor.)

export type EnderecoSalvo = {
  id: string;
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

export type FormEndereco = {
  street: string;
  number: string;
  complement: string;
  neighborhood: string;
  city: string;
  state: string;
  zipCode: string;
};

// Chaves de sessionStorage (a escolha sobrevive ao refresh da compra atual).
export const SESSAO_ENDERECO_ID = "dc_checkout_endereco_id";
export const SESSAO_ENDERECO_FORM = "dc_checkout_endereco_form";

export function lerSessao(chave: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage.getItem(chave);
  } catch {
    return null;
  }
}

export function gravarSessao(chave: string, valor: string) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(chave, valor);
  } catch {
    /* modo privado / storage indisponível — segue sem persistir */
  }
}

export function apagarSessao(chave: string) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(chave);
  } catch {
    /* ignora */
  }
}

// Qual endereço entra no form ao abrir o checkout:
// 1) escolha guardada desta compra  2) padrão  3) o único  4) null
// (null = vários antigos sem padrão → usuário escolhe na tela).
export function escolherEnderecoInicial(
  enderecos: EnderecoSalvo[],
  idGuardado: string | null
): EnderecoSalvo | null {
  if (!enderecos || enderecos.length === 0) return null;
  if (idGuardado) {
    const guardado = enderecos.find((a) => a.id === idGuardado);
    if (guardado) return guardado;
  }
  const padrao = enderecos.find((a) => a.isDefault);
  if (padrao) return padrao;
  if (enderecos.length === 1) return enderecos[0];
  return null;
}

// Endereço completo para o serviço de frete: todos os campos de entrega
// (número NÃO é exigido — opcional).
export function enderecoValido(f: FormEndereco): boolean {
  return (
    f.street.trim().length >= 3 &&
    f.neighborhood.trim().length >= 2 &&
    f.city.trim().length >= 2 &&
    f.state.trim().length === 2 &&
    f.zipCode.replace(/\D/g, "").length === 8
  );
}

// Identidade do cálculo de frete: mesma combinação = mesma chave = mesma
// requisição (dedupe) e mesmo resultado aproveitado (chave do freteOk).
export function chaveFrete(cep: string, subtotal: number, cupom: string | null): string {
  return `${cep.replace(/\D/g, "")}|${subtotal}|${cupom ?? ""}`;
}

export function freteCobreChave(
  frete: { chave: string } | null,
  chaveAtual: string
): boolean {
  return frete !== null && frete.chave === chaveAtual;
}

// Dispara (ou não) um novo cálculo: endereço completo, carrinho carregado,
// sem resultado válido para a chave atual, sem falha prévia p/ esta chave
// (retry é manual — evita loop de retry automático) e sem requisição
// idêntica rodando.
export function deveCalcularFrete(args: {
  enderecoOk: boolean;
  carrinhoCarregado: boolean;
  chaveAtual: string;
  frete: { chave: string } | null;
  emAndamento: boolean;
  chaveEmAndamento: string | null;
  falhaAtual: boolean;
}): boolean {
  if (!args.enderecoOk || !args.carrinhoCarregado) return false;
  if (freteCobreChave(args.frete, args.chaveAtual)) return false; // já tem
  if (args.falhaAtual) return false; // falhou p/ esta chave → retry manual
  if (args.emAndamento && args.chaveEmAndamento === args.chaveAtual) return false; // idem em voo
  return true;
}

// O form do checkout ainda corresponde ao endereço salvo selecionado?
export function formIgualEndereco(f: FormEndereco, a: EnderecoSalvo): boolean {
  const norm = (s: string) => (s || "").trim();
  return (
    norm(f.street) === norm(a.street) &&
    (norm(f.number) || "s/n") === norm(a.number) &&
    (norm(f.complement) || null) === (a.complement || null) &&
    norm(f.neighborhood) === norm(a.neighborhood) &&
    norm(f.city) === norm(a.city) &&
    norm(f.state).toUpperCase() === norm(a.state).toUpperCase() &&
    f.zipCode.replace(/\D/g, "") === a.zipCode.replace(/\D/g, "")
  );
}

// Snapshot só dos campos de endereço (NUNCA dados de cartão) para o form.
export function enderecoDoForm(f: FormEndereco): FormEndereco {
  return {
    street: f.street,
    number: f.number,
    complement: f.complement,
    neighborhood: f.neighborhood,
    city: f.city,
    state: f.state,
    zipCode: f.zipCode,
  };
}

// Endereço salvo → campos do form do checkout.
export function enderecoParaForm(a: EnderecoSalvo): FormEndereco {
  return {
    street: a.street,
    number: a.number,
    complement: a.complement || "",
    neighborhood: a.neighborhood,
    city: a.city,
    state: a.state,
    zipCode: a.zipCode,
  };
}
