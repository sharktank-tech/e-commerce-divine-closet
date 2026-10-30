import { NextRequest, NextResponse } from "next/server";
export const runtime = "nodejs";
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const key = process.env.FASHN_API_KEY;
  const { id } = await params;
  if (!key) return NextResponse.json({ error: "Provador indisponível." }, { status: 503 });
  if (!/^[a-zA-Z0-9-]{1,100}$/.test(id)) return NextResponse.json({ error: "Identificador inválido." }, { status: 400 });
  try {
    const upstream = await fetch(`https://api.fashn.ai/v1/status/${id}`, {
      headers: { Authorization: `Bearer ${key}` }, cache: "no-store", signal: AbortSignal.timeout(12000),
    });
    if (!upstream.ok) return NextResponse.json({ error: "Falha ao consultar resultado." }, { status: 502 });
    const data = await upstream.json() as { status?: string; output?: unknown };
    if (data.status === "completed") {
      const output = Array.isArray(data.output) ? data.output[0] : undefined;
      if (typeof output !== "string" || !(output.startsWith("data:image/") || output.startsWith("https://cdn.fashn.ai/"))) {
        return NextResponse.json({ error: "Resultado indisponível." }, { status: 502 });
      }
      return NextResponse.json({ status: "completed", output });
    }
    if (data.status === "failed") return NextResponse.json({ status: "failed", error: "Não foi possível gerar a imagem. Tente outra foto." });
    return NextResponse.json({ status: "processing" });
  } catch {
    return NextResponse.json({ error: "Falha ao consultar resultado." }, { status: 502 });
  }
}
