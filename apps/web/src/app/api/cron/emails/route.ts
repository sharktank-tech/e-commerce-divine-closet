import { NextRequest, NextResponse } from "next/server";
import { autorizarCron } from "@/lib/cron-auth";
import { drenarEmailsOutbox } from "@/lib/email-outbox";

// Dreno do outbox de e-mails transacionais (segunda janela do dia, 18h —
// complementa o dreno das 09h do cron de carrinho). Plano Hobby: cada cron
// roda no máx. 1x/dia; as tentativas IMEDIATAS (logo após a transição) já
// acontecem no próprio fluxo — aqui ficam as retentativas de falhas
// transitórias (rede/429/5xx) e a última chance antes de esgotar.
// Fuso: "0 21 * * *" UTC = 18:00 em Araguaina (UTC−3). Atraso máximo
// esperado de um e-mail com falha transitória: até a próxima janela (≤24h;
// tipicamente ≤9h, das 09h para as 18h).
// Auth: CRON_SECRET (mesma proteção das demais rotas cron).
export async function GET(req: NextRequest) {
  try {
    if (!autorizarCron(req.headers.get("authorization"), process.env.CRON_SECRET)) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }

    const resultado = await drenarEmailsOutbox();
    return NextResponse.json({ ok: true, ...resultado });
  } catch (err) {
    console.error("[cron:emails]", err);
    return NextResponse.json({ error: "Erro no dreno do outbox" }, { status: 500 });
  }
}
