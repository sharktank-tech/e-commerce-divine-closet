import { z } from "zod";

// Validadores centrais de campos (item 8) — puros e testáveis.
//
// Cada função devolve um código; as rotas mapeiam códigos para as SUAS
// mensagens/status (contratos de API inalterados). Regras novas que
// rejeitam entradas antes aceitas usam as mensagens da especificação
// ("Nome é obrigatório", "Nome inválido", "Telefone inválido",
// "CEP não encontrado") — documentadas nos commits que as ligam.

export type CodigoValidacao =
  | "OK"
  | "OBRIGATORIO"
  | "CURTO"
  | "LONGO"
  | "FORMATO"
  | "DOMINIO"
  | "DDD"
  | "INEXISTENTE";

// Letras (qualquer idioma, inclui acentos) e espaços — sem dígitos/símbolos.
export const NOME_LETRAS = /^[\p{L} ]+$/u;

// DDDs brasileiros válidos (ANATEL).
export const DDDS_VALIDOS = new Set([
  11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 24, 27, 28, 31, 32, 33, 34,
  35, 37, 38, 41, 42, 43, 44, 45, 46, 47, 48, 49, 51, 53, 54, 55, 61, 62,
  63, 64, 65, 66, 67, 68, 69, 71, 73, 74, 75, 77, 79, 81, 82, 83, 84, 85,
  86, 87, 88, 89, 91, 93, 94, 95, 96, 97, 98, 99,
]);

function soDigitos(v: string): string {
  return v.replace(/\D/g, "");
}

/** Nome: obrigatório, 2–100 caracteres, só letras/espaços. */
export function validarNome(v: unknown): CodigoValidacao {
  if (typeof v !== "string" || v.trim() === "") return "OBRIGATORIO";
  const t = v.trim();
  if (t.length < 2) return "CURTO";
  if (t.length > 100) return "LONGO";
  if (!NOME_LETRAS.test(t)) return "FORMATO";
  return "OK";
}

const EMAIL_BASE = /^[^\s@]+@[^\s@]+$/;

/** E-mail: formato + domínio sintático (com ponto e rótulos válidos). */
export function validarEmail(v: unknown): CodigoValidacao {
  if (typeof v !== "string" || v.trim() === "") return "OBRIGATORIO";
  const t = v.trim();
  if (!EMAIL_BASE.test(t)) return "FORMATO";
  const dominio = t.split("@")[1] ?? "";
  const rotulos = dominio.split(".");
  const rotuloOk = (r: string) => /^[a-z0-9-]+$/i.test(r) && !r.startsWith("-") && !r.endsWith("-");
  if (rotulos.length < 2 || !rotulos.every(rotuloOk) || rotulos[rotulos.length - 1].length < 2) {
    return "DOMINIO";
  }
  return "OK";
}

/** CEP: exatamente 8 dígitos. */
export function validarCep(v: unknown): CodigoValidacao {
  if (typeof v !== "string" || v.trim() === "") return "OBRIGATORIO";
  if (!/^\d{8}$/.test(soDigitos(v))) return "FORMATO";
  return "OK";
}

/**
 * Existência do CEP via lookup injetável (ex.: ViaCEP em produção, mock
 * em testes). Sem `buscar`, só valida o formato. Nunca faz rede sozinha.
 */
export async function verificarCepExiste(
  v: unknown,
  buscar?: (digitos: string) => Promise<boolean>
): Promise<CodigoValidacao> {
  const formato = validarCep(v);
  if (formato !== "OK") return formato;
  if (!buscar) return "OK";
  const existe = await buscar(soDigitos(String(v)));
  return existe ? "OK" : "INEXISTENTE";
}

/** Telefone BR: 10–11 dígitos com DDD válido. Vazio = OK (opcional). */
export function validarTelefone(
  v: unknown,
  opts: { obrigatorio?: boolean } = {}
): CodigoValidacao {
  if (v == null || (typeof v === "string" && v.trim() === "")) {
    return opts.obrigatorio ? "OBRIGATORIO" : "OK";
  }
  if (typeof v !== "string") return "FORMATO";
  const d = soDigitos(v);
  if (d.length !== 10 && d.length !== 11) return "FORMATO";
  if (!DDDS_VALIDOS.has(Number(d.slice(0, 2)))) return "DDD";
  return "OK";
}

/** "01310100" → "01310-100". Fora do formato, devolve a entrada. */
export function mascararCep(v: string): string {
  const d = soDigitos(v);
  return d.length === 8 ? `${d.slice(0, 5)}-${d.slice(5)}` : v;
}

/** 11 dígitos → "(11) 99999-0000"; 10 → "(11) 9999-0000"; senão, a entrada. */
export function mascararTelefone(v: string): string {
  const d = soDigitos(v);
  if (d.length === 11) {
    return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  }
  if (d.length === 10) {
    return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  }
  return v;
}

// Endereço compartilhado por /api/pedidos e /api/enderecos — definições
// idênticas às que já existiam nas rotas (mensagens padrão do zod intactas).
// Cada rota estende com seus campos próprios (label, isDefault).
export const enderecoSchema = z.object({
  street: z.string().min(3),
  number: z.string().min(1),
  complement: z.string().nullish(),
  neighborhood: z.string().min(2),
  city: z.string().min(2),
  state: z.string().min(2),
  zipCode: z.string().min(8),
});
