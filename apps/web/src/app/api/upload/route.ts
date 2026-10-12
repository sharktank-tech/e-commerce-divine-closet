import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { deleteUpload, saveUpload } from "@/lib/upload";
import { naVez } from "@/lib/rate-limit";

// Cota anti-abuso: 20 uploads/dia por cliente (staff isento — produto).
const LIMITE_UPLOADS_DIA = 20;

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

    if (session.role === "CLIENT") {
      // Reserva atômica em 1 statement: insere a linha de auditoria só se
      // a cota do dia não estourou. Sem transação interativa (não escala
      // sob rajada) e sem advisory lock — a atomicidade vem do statement.
      // AuditLog.userId é TEXT: sem casts (o Postgres infere pela coluna).
      const inicioDia = new Date();
      inicioDia.setHours(0, 0, 0, 0);
      let reservado = false;
      try {
        // Fila por usuário: cada tentativa enxerga as reservas anteriores.
        reservado = await naVez(`upload:${session.sub}`, async () => {
          const linhas = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
            `INSERT INTO "AuditLog" (id, "userId", action, entity, "entityId", "createdAt")
             SELECT gen_random_uuid(), $1, 'upload', 'Upload', $2, NOW()
             WHERE (SELECT COUNT(*) FROM "AuditLog"
                    WHERE "userId" = $1 AND action = 'upload' AND "createdAt" >= $3) < $4
             RETURNING id`,
            session.sub,
            result.filename,
            inicioDia,
            LIMITE_UPLOADS_DIA
          );
          return linhas.length > 0;
        });
      } catch (err) {
        // Falha de infra na reserva: apaga o arquivo e nega (fail-closed).
        console.error("[upload:auditoria]", err);
        await deleteUpload(result.url).catch(() => {});
        throw err;
      }
      if (!reservado) {
        await deleteUpload(result.url).catch(() => {});
        return NextResponse.json(
          { error: `Limite diário de uploads atingido (${LIMITE_UPLOADS_DIA}/dia).` },
          { status: 429 }
        );
      }
    } else {
      // Staff sem cota, mas com rastro de auditoria (best-effort).
      prisma.auditLog
        .create({
          data: {
            id: randomUUID(),
            userId: session.sub,
            action: "upload",
            entity: "Upload",
            entityId: result.filename,
            meta: {},
          },
        })
        .catch((err) => console.error("[upload:auditoria]", err));
    }
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro no upload";
    console.error("[upload]", err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
