import { createHmac, timingSafeEqual } from "crypto";

export { CONSENT_VERSION } from "./consent";
function secret() {
  const s = process.env.NEWSLETTER_SECRET || process.env.JWT_SECRET;
  if (!s || s.length < 32)
    throw new Error("Segredo de newsletter não configurado");
  return s;
}
export function marketingToken(
  id: string,
  version: string,
  purpose: "confirm" | "unsubscribe",
) {
  const mac = createHmac("sha256", secret())
    .update(`newsletter:${purpose}:${id}:${version}`)
    .digest("hex");
  return `${id}.${mac}`;
}
export function tokenId(token: unknown): string | null {
  return typeof token === "string" &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.[a-f0-9]{64}$/.test(
      token,
    )
    ? token.slice(0, 36)
    : null;
}
export function tokenMatches(
  token: string,
  id: string,
  version: string,
  purpose: "confirm" | "unsubscribe",
) {
  const expected = marketingToken(id, version, purpose);
  return (
    token.length === expected.length &&
    timingSafeEqual(Buffer.from(token), Buffer.from(expected))
  );
}
export function marketingBaseUrl() {
  const url = new URL(
    process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
  );
  if (
    process.env.NODE_ENV === "production" &&
    url.protocol !== "https:" &&
    !["localhost", "127.0.0.1"].includes(url.hostname)
  )
    throw new Error("URL pública inválida");
  return url.origin;
}
