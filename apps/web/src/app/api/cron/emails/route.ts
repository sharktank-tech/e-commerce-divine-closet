import { NextRequest, NextResponse } from "next/server";
import { drenarEmailsOutbox } from "@/lib/email-outbox";

// Dreno do outbox de e-mails transacionais (segunda janela do dia, 18h —
// complementa o dreno das 09h do cron de carrinho). Plano Hobby: cada cron
// roda no máx. 1x/dia; as tentativas IMEDIATAS (logo após a transição) já
// acontecem no próprio fluxo — aqui ficam as retentativas de falhas
// transitórias (rede/429/5xx) e a última chance antes de esgotar.
// Auth: CRON_SECRET (mesma proteção das demais rotas cron).
export async function GET(req: NextRequest) {
  try {
    const secret = process.env.CRON_SECRET;
    const auth = req.headers.get("authorization") || "";
    if (!secret || auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }

    const resultado = await drenarEmailsOutbox();
    return NextResponse.json({ ok: true, ...resultado });
  } catch (err) {
    console.error("[cron:emails]", err);
    return NextResponse.json({ error: "Erro no dreno do outbox" }, { status: 500 });
  }
}
