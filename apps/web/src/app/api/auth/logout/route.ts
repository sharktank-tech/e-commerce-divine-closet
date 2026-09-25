import { NextResponse } from "next/server";
import { clearSession } from "@/lib/auth";

export async function POST() {
  await clearSession("CLIENT");
  await clearSession("ADMIN");
  return NextResponse.json({ ok: true });
}
