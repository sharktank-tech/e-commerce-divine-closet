import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import bcrypt from "bcryptjs";
import { NextRequest, NextResponse } from "next/server";

export type StaffRole = "ADMIN" | "OPERATOR" | "MARKETING";
export type ClientRole = "CLIENT";

export type SessionPayload = {
  sub: string;
  email: string;
  name: string;
  role: StaffRole | ClientRole;
};

const secret = new TextEncoder().encode(
  process.env.JWT_SECRET || "dev-secret-troque-em-producao"
);

const COOKIE = {
  client: "dc_session",
  admin: "dc_admin_session",
  guest: "dc_guest",
} as const;

export function cookieName(role: StaffRole | ClientRole) {
  return role === "CLIENT" ? COOKIE.client : COOKIE.admin;
}

export function isStaff(role?: string): role is StaffRole {
  return role === "ADMIN" || role === "OPERATOR" || role === "MARKETING";
}

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

export async function signToken(
  payload: SessionPayload,
  role: SessionPayload["role"]
) {
  const hours = Number(
    process.env[
      role === "CLIENT" ? "JWT_EXPIRES_HOURS" : "ADMIN_JWT_EXPIRES_HOURS"
    ] || (role === "CLIENT" ? 72 : 12)
  );

  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${hours}h`)
    .sign(secret);
}

export async function verifyToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secret);
    return payload as unknown as SessionPayload;
  } catch {
    return null;
  }
}

export async function setSession(session: SessionPayload) {
  const token = await signToken(session, session.role);
  const store = await cookies();
  const hours = Number(
    process.env[
      session.role === "CLIENT" ? "JWT_EXPIRES_HOURS" : "ADMIN_JWT_EXPIRES_HOURS"
    ] || (session.role === "CLIENT" ? 72 : 12)
  );

  store.set(cookieName(session.role), token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: hours * 60 * 60,
  });
}

export async function clearSession(role: StaffRole | ClientRole) {
  const store = await cookies();
  store.delete(cookieName(role));
}

export async function getSession(
  req?: NextRequest
): Promise<SessionPayload | null> {
  let token: string | undefined;

  if (req) {
    token = req.cookies.get(COOKIE.client)?.value || req.cookies.get(COOKIE.admin)?.value;
  } else {
    const store = await cookies();
    token = store.get(COOKIE.client)?.value || store.get(COOKIE.admin)?.value;
  }

  if (!token) return null;
  return verifyToken(token);
}

export async function requireAuth(role?: StaffRole | ClientRole) {
  const session = await getSession();
  if (!session) return null;
  if (!role) return session;
  if (role === "ADMIN") {
    if (!isStaff(session.role)) return null;
  } else if (session.role !== role) {
    return null;
  }
  return session;
}

export function unauthorized(message = "Não autenticado") {
  return NextResponse.json({ error: message }, { status: 401 });
}

export function forbidden(message = "Acesso negado") {
  return NextResponse.json({ error: message }, { status: 403 });
}
