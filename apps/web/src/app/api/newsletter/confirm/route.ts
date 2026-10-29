import { NextRequest, NextResponse } from "next/server";
import {
  applyNewsletterToken,
  newsletterLimit,
} from "@/lib/marketing/newsletter";
export async function GET() {
  return NextResponse.json(
    { message: "Use o botão da página para confirmar a operação." },
    { headers: { "Cache-Control": "no-store" } },
  );
}
export async function POST(req: NextRequest) {
  try {
    if (!(await newsletterLimit(req)))
      return NextResponse.json(
        { error: "Aguarde antes de tentar novamente." },
        { status: 429 },
      );
    const body = await req.json().catch(() => null);
    const ok = await applyNewsletterToken(body?.token, "confirm");
    return NextResponse.json(
      ok
        ? { ok: true, message: "Inscrição confirmada." }
        : { error: "Link inválido ou expirado." },
      { status: ok ? 200 : 400, headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { error: "Operação temporariamente indisponível." },
      { status: 503 },
    );
  }
}
