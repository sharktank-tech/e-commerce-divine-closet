export type RedeSocial = "instagram" | "facebook";

/** Campo opcional: somente links HTTPS da própria rede, sem credenciais. */
export function linkRedeSocial(valor: unknown, rede: RedeSocial): string | null {
  if (typeof valor !== "string" || !valor.trim()) return null;
  try {
    const url = new URL(valor.trim());
    const dominio = `${rede}.com`;
    if (url.protocol !== "https:" || url.username || url.password || url.port ||
        !(url.hostname === dominio || url.hostname.endsWith(`.${dominio}`))) return null;
    return url.href;
  } catch {
    return null;
  }
}
