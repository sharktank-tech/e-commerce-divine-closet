import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";

const secret = new TextEncoder().encode(
  process.env.JWT_SECRET || "dev-secret-troque-em-producao"
);

async function readToken(req: NextRequest, name: string) {
  const token = req.cookies.get(name)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret);
    return payload as { role?: string };
  } catch {
    return null;
  }
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const isAdmin = pathname.startsWith("/admin");
  const isAdminApi = pathname.startsWith("/api/admin");
  const isAccount = pathname.startsWith("/conta");
  const isAuthApi =
    pathname.startsWith("/api/auth") && pathname !== "/api/auth/logout";

  if (isAuthApi) return NextResponse.next();

  if (isAdmin || isAdminApi) {
    const admin = await readToken(req, "dc_admin_session");
    const isLoginPage = pathname === "/admin/login";

    if (!admin || (admin.role !== "ADMIN" && admin.role !== "OPERATOR" && admin.role !== "MARKETING")) {
      if (isLoginPage) return NextResponse.next();
      if (isAdminApi) {
        return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
      }
      const url = req.nextUrl.clone();
      url.pathname = "/admin/login";
      url.searchParams.set("next", pathname);
      return NextResponse.redirect(url);
    }

    if (isLoginPage) {
      const url = req.nextUrl.clone();
      url.pathname = "/admin";
      url.search = "";
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

  // Checkout é aberto a convidados (guest); /api/pedidos valida a identificação.
  if (isAccount) {
    const client = await readToken(req, "dc_session");
    if (!client || client.role !== "CLIENT") {
      const url = req.nextUrl.clone();
      url.pathname = "/login";
      url.searchParams.set("next", pathname);
      return NextResponse.redirect(url);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/admin/:path*",
    "/api/admin/:path*",
    "/conta/:path*",
    "/api/auth/register",
    "/api/auth/login",
    "/api/auth/me",
  ],
};
