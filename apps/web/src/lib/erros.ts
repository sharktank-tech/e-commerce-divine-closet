import { NextRequest, NextResponse } from "next/server";

// Tratamento de erros (item 9) — adaptado ao App Router (não há middleware
// estilo Express aqui): as rotas exportam handlers embrulhados em `comErro`.
// Erro operacional (4xx, esperado: negócio/validação) vira JSON estruturado;
// erro de sistema (5xx ou desconhecido) vira 500 genérico sem stack trace.
// Respostas de erro já tratadas dentro das rotas passam intactas.

export class AppError extends Error {
  statusCode: number;
  isOperational: boolean;
  code: string;

  constructor(message: string, statusCode = 400, code = "ERROR") {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    // Operacional = erro esperado de negócio/validação (4xx). Sistema = 5xx.
    this.isOperational = statusCode >= 400 && statusCode < 500;
    this.code = code;
    if (typeof Error.captureStackTrace === "function") {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

export function erroResposta(err: AppError): NextResponse {
  return NextResponse.json(
    { success: false, error: err.message, code: err.code },
    { status: err.statusCode }
  );
}

export function logErro(contexto: Record<string, unknown>, err: unknown): void {
  const base = {
    nivel: "erro",
    em: new Date().toISOString(),
    ...contexto,
  };
  if (err instanceof AppError) {
    console.error(
      JSON.stringify({
        ...base,
        codigo: err.code,
        status: err.statusCode,
        operacional: err.isOperational,
        mensagem: err.message,
      })
    );
    return;
  }
  console.error(
    JSON.stringify({
      ...base,
      codigo: "INTERNAL_ERROR",
      status: 500,
      operacional: false,
      mensagem: err instanceof Error ? err.message : String(err),
    })
  );
}

type ManipuladorRota = (
  req: NextRequest,
  ctx?: unknown
) => Promise<NextResponse | Response>;

/**
 * Embrulha um route handler: AppError vira JSON estruturado com seu status;
 * qualquer outro erro vira 500 genérico (logado com contexto, sem vazar
 * stack). Rotas que já tratam seus erros internamente não mudam de
 * comportamento — o wrapper só cobre o que escaparia como 500 HTML do Next.
 */
export function comErro(
  manipulador: ManipuladorRota,
  contexto: Record<string, unknown> = {}
): ManipuladorRota {
  return async (req: NextRequest, ctx?: unknown) => {
    const pedidoId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : String(Date.now());
    try {
      return await manipulador(req, ctx);
    } catch (err) {
      logErro({ pedidoId, ...contexto }, err);
      if (err instanceof AppError) return erroResposta(err);
      return NextResponse.json(
        {
          success: false,
          error: "Ops! Algo deu errado. Tente novamente mais tarde.",
          code: "INTERNAL_ERROR",
        },
        { status: 500 }
      );
    }
  };
}
