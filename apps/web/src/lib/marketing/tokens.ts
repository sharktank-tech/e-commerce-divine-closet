import { createHmac } from "crypto";

function getSecret(): string {
  return process.env.MARKETING_TOKEN_SECRET || process.env.JWT_SECRET || "dev-secret";
}

export function marketingToken(id: string, version: string | number, action: "confirm" | "unsubscribe"): string {
  const payload = `${id}:${version}:${action}`;
  const sig = createHmac("sha256", getSecret()).update(payload).digest("hex").slice(0, 16);
  return `${id}:${version}:${action}:${sig}`;
}

export function tokenMatches(token: string, id: string, version: string | number, action: "confirm" | "unsubscribe"): boolean {
  const parts = token.split(":");
  if (parts.length !== 4) return false;
  const [tid, tver, taction, tsig] = parts;
  if (tid !== id || tver !== String(version) || taction !== action) return false;
  const expected = createHmac("sha256", getSecret()).update(`${id}:${version}:${action}`).digest("hex").slice(0, 16);
  return tsig === expected;
}

export function verifyMarketingToken(token: string): { id: string; version: string; action: string } | null {
  const parts = token.split(":");
  if (parts.length !== 4) return null;
  const [id, version, action, sig] = parts;
  const expected = createHmac("sha256", getSecret()).update(`${id}:${version}:${action}`).digest("hex").slice(0, 16);
  if (sig !== expected) return null;
  return { id, version, action };
}
