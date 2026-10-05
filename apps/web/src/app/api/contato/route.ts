import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { sendEmail } from "@/lib/email";
import { getEmpresa } from "@/lib/config-loja";
import { validarEmail, validarNome } from "@/lib/validacao";
import { comErro } from "@/lib/erros";

// Formulário de contato da loja: entrega a mensagem no e-mail da empresa
// (painel → empresa.email). Erro de envio retorna 500 — aqui o visitante
// precisa saber que a mensagem NÃO saiu (não é fluxo anti-enumeração).
const schema = z.object({
  name: z
    .string()
    .min(1, "Nome é obrigatório")
    .min(2, "Nome muito curto")
    .max(100, "Nome muito longo")
    .refine((v) => validarNome(v) === "OK", "Nome inválido"),
  email: z
    .string()
    .email("E-mail inválido")
    .refine((v) => validarEmail(v) === "OK", "E-mail inválido"),
  message: z.string().min(10, "Mensagem muito curta (mínimo 10 caracteres)"),
});

export const POST = comErro(async (req: NextRequest) => {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Dados inválidos" },
      { status: 400 }
    );
  }

  const empresa = await getEmpresa();
  try {
    await sendEmail({
      to: empresa.email,
      subject: `[Contato] ${parsed.data.name}`,
      text: [
        `Nome: ${parsed.data.name}`,
        `E-mail: ${parsed.data.email}`,
        "",
        parsed.data.message,
      ].join("\n"),
    });
  } catch (err) {
    console.error("[contato:email]", err);
    return NextResponse.json(
      { error: "Não foi possível enviar sua mensagem. Tente novamente." },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}, { rota: "contato" });
