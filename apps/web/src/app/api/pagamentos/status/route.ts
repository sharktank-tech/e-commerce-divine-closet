import { NextResponse } from "next/server";

// Diagnóstico do gateway (sem segredos): diz QUAL variável falta no
// deployment atual (produção vs preview na Vercel têm envs separados).
// GET /api/pagamentos/status → { driver, publicKey, accessToken, webhookSecret, notificationUrl }
export async function GET() {
  const notificacao =
    process.env.MP_NOTIFICATION_URL ||
    (process.env.NEXT_PUBLIC_APP_URL
      ? `${process.env.NEXT_PUBLIC_APP_URL}/api/pagamentos/webhook`
      : null);
  return NextResponse.json({
    driver: process.env.PAYMENT_DRIVER || "mock",
    publicKey: !!process.env.MP_PUBLIC_KEY,
    accessToken: !!process.env.MP_ACCESS_TOKEN,
    webhookSecret: !!process.env.MP_WEBHOOK_SECRET,
    notificationUrl: notificacao,
  });
}
