import { NextResponse } from "next/server";

// Public key do Mercado Pago para tokenização no front (pública por
// desenho; o segredo nunca sai do servidor).
export async function GET() {
  return NextResponse.json({ publicKey: process.env.MP_PUBLIC_KEY || null });
}
