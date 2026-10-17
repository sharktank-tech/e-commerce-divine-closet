// Rastreamento de pedidos para o cliente (/conta e acompanhamento).
// Regras: só gerar link para transportadoras reconhecidas (URLs oficiais
// verificadas) ou aceitar link externo informado pelo admin APENAS se
// HTTPS e host na allowlist. Nunca inventar link para código sem
// transportadora identificada.

export type TransportadoraOpcao = {
  id: string;
  nome: string;
  /** Site oficial de rastreio (sem código embutido) — verificado (HTTP 200). */
  site: string;
};

export const TRANSPORTADORAS: TransportadoraOpcao[] = [
  { id: "correios", nome: "Correios", site: "https://rastreamento.correios.com.br/app/index.php" },
  { id: "jadlog", nome: "Jadlog", site: "https://www.jadlog.com.br/" },
  { id: "loggi", nome: "Loggi", site: "https://www.loggi.com/" },
  { id: "melhor-envio", nome: "Melhor Envio", site: "https://www.melhorenvio.com.br/" },
  { id: "azul", nome: "Azul Cargo", site: "https://www.azul.com.br/" },
];

/** Destinos permitidos para link de rastreio informado pelo admin. */
const HOSTS_RASTREIO_PERMITIDOS = [
  "rastreamento.correios.com.br",
  "correios.com.br",
  "jadlog.com.br",
  "loggi.com",
  "melhorenvio.com.br",
  "azul.com.br",
];

/**
 * Valida link de rastreio externo: HTTPS obrigatório, sem credenciais na
 * URL e host dentro da allowlist (subdomínios incluídos). Retorna a URL
 * normalizada ou null quando deve ser ignorada.
 */
export function validarUrlRastreio(url: unknown): string | null {
  if (typeof url !== "string" || url.length === 0 || url.length > 2048) return null;
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:") return null;
  if (u.username || u.password) return null;
  const host = u.hostname.toLowerCase();
  const permitido = HOSTS_RASTREIO_PERMITIDOS.some(
    (h) => host === h || host.endsWith(`.${h}`)
  );
  if (!permitido) return null;
  return u.toString();
}

/** Nome amigável da transportadora (id conhecido ou texto livre do admin). */
export function rotuloTransportadora(carrier: string | null | undefined): string | null {
  if (!carrier) return null;
  const limpo = carrier.trim().slice(0, 80);
  if (!limpo) return null;
  const conhecida = TRANSPORTADORAS.find((t) => t.id === limpo);
  return conhecida ? conhecida.nome : limpo;
}

/**
 * Site oficial de rastreio da transportadora (quando é uma conhecida).
 * Transportadora desconhecida → null (nunca inventar link).
 */
export function siteRastreioTransportadora(carrier: string | null | undefined): string | null {
  if (!carrier) return null;
  const conhecida = TRANSPORTADORAS.find((t) => t.id === carrier.trim());
  return conhecida ? conhecida.site : null;
}

/**
 * Link final exibido ao cliente: prioriza o link validado do admin;
 * senão, o site oficial da transportadora conhecida; sem os dois → null
 * (só código + copiar, sem botão "Acompanhar entrega").
 */
export function linkRastreio(pedido: {
  trackingCarrier?: string | null;
  trackingUrl?: string | null;
}): string | null {
  const urlAdmin = validarUrlRastreio(pedido.trackingUrl);
  if (urlAdmin) return urlAdmin;
  return siteRastreioTransportadora(pedido.trackingCarrier);
}

/**
 * Mensagem quando NÃO há código de rastreio — clara e sem indicar que o
 * pedido já foi enviado.
 */
export function mensagemSemRastreio(status: string): string {
  if (status === "SHIPPED" || status === "DELIVERED") {
    return "Código de rastreio ainda não informado. Assim que disponível, ele aparece aqui.";
  }
  if (status === "CANCELLED") return "Pedido cancelado — não há rastreamento.";
  if (status === "REFUNDED") return "Pedido estornado — não há rastreamento.";
  return "Rastreamento disponível após a postagem do pedido. Ainda não há código.";
}
