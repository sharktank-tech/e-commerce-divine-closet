import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const message = "Não foi possível iniciar o provador agora.";
export async function POST(request: NextRequest) {
  const key = process.env.FASHN_API_KEY;
  if (!key) return NextResponse.json({ error: "Provador indisponível no momento." }, { status: 503 });
  if (Number(request.headers.get("content-length") || 0) > 7_000_000) {
    return NextResponse.json({ error: "Imagem muito grande (limite: 4 MB)." }, { status: 413 });
  }
  try {
    const input = await request.json() as { productId?: unknown; modelImage?: unknown; consent?: unknown };
    if (input.consent !== true || typeof input.productId !== "string" || typeof input.modelImage !== "string" ||
        input.modelImage.length > 5_600_000 ||
        !/^data:image\/(jpeg|png|webp);base64,[a-zA-Z0-9+/=]+$/.test(input.modelImage)) {
      return NextResponse.json({ error: "Foto ou consentimento inválido." }, { status: 400 });
    }
    const product = await prisma.product.findFirst({
      where: { id: input.productId, isActive: true, deletedAt: null },
      select: { images: true },
    });
    const garment = product?.images.find((img) => /^https:\/\//.test(img));
    if (!garment) return NextResponse.json({ error: "Produto sem imagem pública compatível." }, { status: 400 });
    const upstream = await fetch("https://api.fashn.ai/v1/run", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model_name: "tryon-v1.6",
        inputs: { model_image: input.modelImage, garment_image: garment, category: "auto",
          mode: "balanced", num_samples: 1, output_format: "jpeg", return_base64: true },
      }),
      signal: AbortSignal.timeout(25000),
      cache: "no-store",
    });
    if (!upstream.ok) return NextResponse.json({ error: message }, { status: 502 });
    const data = await upstream.json() as { id?: string };
    if (!data.id || !/^[a-zA-Z0-9-]{1,100}$/.test(data.id)) throw new Error("invalid prediction id");
    return NextResponse.json({ id: data.id });
  } catch {
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
