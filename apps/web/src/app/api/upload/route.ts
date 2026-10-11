import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { saveUpload } from "@/lib/upload";

// Cota anti-abuso: 20 uploads/dia por cliente (staff isento — produto).
const LIMITE_UPLOADS_DIA = 20;

export async function POST(req: NextRequest) {
  try {
    // qualquer usuário autenticado (fotos de avaliação sobem por aqui);
    // o admin continua podendo tudo. Validação de tipo/tamanho no saveUpload.
    const session = await getSession(req);
    if (!session) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

    if (session.role === "CLIENT") {
      const inicioDia = new Date();
      inicioDia.setHours(0, 0, 0, 0);
      const hoje = await prisma.auditLog.count({
        where: { userId: session.sub, action: "upload", createdAt: { gte: inicioDia } },
      });
      if (hoje >= LIMITE_UPLOADS_DIA) {
        return NextResponse.json(
          { error: `Limite diário de uploads atingido (${LIMITE_UPLOADS_DIA}/dia).` },
          { status: 429 }
        );
      }
    }

    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Arquivo não enviado" }, { status: 400 });
    }

    const result = await saveUpload(file);
    try {
      await prisma.auditLog.create({
        data: {
          // id explícito: a coluna no banco está sem default
          // (divergência schema×DB); sem ele o create falha.
          id: randomUUID(),
          userId: session.sub,
          action: "upload",
          entity: "Upload",
          entityId: result.filename,
          meta: {},
        },
      });
    } catch (err) {
      // Auditoria não pode quebrar o upload; a cota pode ficar
      // momentaneamente frouxa (log registra para acompanhamento).
      console.error("[upload:auditoria]", err);
    }
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro no upload";
    console.error("[upload]", err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
