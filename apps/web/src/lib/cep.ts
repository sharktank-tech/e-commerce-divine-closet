// Busca de endereço por CEP (ViaCEP — gratuita, sem chave, com CORS).
// Campos que o ViaCEP não devolve ficam vazios (número e complemento
// nunca vêm no CEP e permanecem para digitação manual).

export type EnderecoCep = {
  street: string;
  neighborhood: string;
  city: string;
  state: string;
};

type RespostaViaCep = {
  erro?: boolean | string;
  logradouro?: string;
  bairro?: string;
  localidade?: string;
  uf?: string;
};

export async function buscarEnderecoPorCep(
  cep: string,
  buscar: typeof fetch = fetch
): Promise<EnderecoCep | null> {
  const digitos = cep.replace(/\D/g, "");
  if (digitos.length !== 8) return null;
  const r = await buscar(`https://viacep.com.br/ws/${digitos}/json/`, {
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw new Error("Falha na busca do CEP.");
  const d = (await r.json()) as RespostaViaCep;
  if (!d || d.erro) return null;
  return {
    street: d.logradouro || "",
    neighborhood: d.bairro || "",
    city: d.localidade || "",
    state: d.uf || "",
  };
}
