import { NextRequest, NextResponse } from "next/server";
import { reconciliarPixPendentes } from "@/lib/reconciliar-pix";

// Gatilho MANUAL da reconciliação de Pix (mesmo código do piggyback no
// cron diário de carrinho-abandonado). Protegido por CRON_SECRET — pode
// ser chamado a qualquer momento p/ consertar Pix órfão sem esperar o cron.
export async function GET(req: NextRequest) {
  try {
    const secret = process.env.CRON_SECRET;
    const auth = req.headers.get("authorization") || "";
    if (!secret || auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }

    const resumo = await reconciliarPixPendentes();
    return NextResponse.json({ ok: true, ...resumo });
  } catch (err) {
    console.error("[cron:reconciliar-pix]", err);
    return NextResponse.json({ error: "Erro na reconciliação" }, { status: 500 });
  }
}
