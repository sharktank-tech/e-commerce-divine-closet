import { createHash, timingSafeEqual } from "crypto";

// Autenticação das rotas cron (Vercel envia `Authorization: Bearer ${CRON_SECRET}`).
// Comparação em tempo constante sobre hashes SHA-256: o tamanho do segredo não
// vaza pelo timing da comparação de strings (==/!== de JS é variável).
// Segredo ausente = rota DESLIGADA (nunca "abre por omissão").
export function autorizarCron(
  header: string | null | undefined,
  secret: string | undefined
): boolean {
  if (!secret || !header) return false;
  const prefixo = "Bearer ";
  if (!header.startsWith(prefixo)) return false;
  const token = header.slice(prefixo.length);
  if (!token) return false;
  const a = createHash("sha256").update(token).digest();
  const b = createHash("sha256").update(secret).digest();
  return timingSafeEqual(a, b);
}
