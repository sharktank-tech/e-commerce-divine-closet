import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { saveUpload } from "@/lib/upload";

export async function POST(req: NextRequest) {
  try {
    // qualquer usuário autenticado (fotos de avaliação sobem por aqui);
    // o admin continua podendo tudo. Validação de tipo/tamanho no saveUpload.
    const session = await getSession(req);
    if (!session) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Arquivo não enviado" }, { status: 400 });
    }

    const result = await saveUpload(file);
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro no upload";
    console.error("[upload]", err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
