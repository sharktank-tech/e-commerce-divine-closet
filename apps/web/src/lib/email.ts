import nodemailer from "nodemailer";

type SendEmailInput = {
  to: string;
  subject: string;
  html?: string;
  text?: string;
};

/**
 * E-mail transacional.
 * - EMAIL_DRIVER=mock → apenas loga no console (dev)
 * - EMAIL_DRIVER=smtp → envio real via SMTP (Zoho Mail em produção)
 */
export async function sendEmail(input: SendEmailInput): Promise<void> {
  const driver = process.env.EMAIL_DRIVER || "mock";

  if (driver === "mock") {
    console.log("────────────────────────────────────────");
    console.log("[EMAIL MOCK]");
    console.log(`De: ${process.env.EMAIL_FROM || "Divine Closet"}`);
    console.log(`Para: ${input.to}`);
    console.log(`Assunto: ${input.subject}`);
    console.log(input.text || stripHtml(input.html || ""));
    console.log("────────────────────────────────────────");
    return;
  }

  if (driver === "smtp") {
    const host = process.env.SMTP_HOST;
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    if (!host || !user || !pass) {
      throw new Error(
        "SMTP não configurado (defina SMTP_HOST, SMTP_USER e SMTP_PASS)."
      );
    }

    const port = Number(process.env.SMTP_PORT || 587);
    // porta 465 = TLS direto; demais (587) = STARTTLS
    const secure =
      process.env.SMTP_SECURE != null
        ? process.env.SMTP_SECURE === "true"
        : port === 465;

    const transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: { user, pass },
    });

    await transporter.sendMail({
      from: process.env.EMAIL_FROM || user,
      to: input.to,
      subject: input.subject,
      text: input.text,
      html: input.html,
    });
    return;
  }

  throw new Error(`Driver de e-mail não suportado: ${driver}`);
}

function stripHtml(html: string) {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

export const emails = {
  welcome: (name: string) => ({
    subject: "Bem-vinda(o) à Divine Closet 💫",
    text: `Olá ${name}, sua conta foi criada com sucesso. Bom shopping!`,
  }),
  orderCreated: (number: string, total: string) => ({
    subject: `Pedido ${number} recebido`,
    text: `Recebemos seu pedido ${number} no valor de ${total}. Assim que o pagamento for confirmado, você receberá uma nova atualização.`,
  }),
  orderPaid: (number: string) => ({
    subject: `Pedido ${number} pago com sucesso`,
    text: `Pagamento confirmado para o pedido ${number}. Estamos preparando seu envio.`,
  }),
  passwordReset: (link: string) => ({
    subject: "Redefinir senha - Divine Closet",
    text: [
      "Olá!",
      "",
      "Recebemos um pedido de redefinição de senha da sua conta Divine Closet.",
      "Copie e cole o link abaixo no navegador (válido por 1 hora):",
      link,
      "",
      "Se não foi você, ignore este e-mail — sua senha permanece a mesma.",
    ].join("\n"),
    html: `<div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;color:#1f2937">
  <div style="background:#9E2BBA;padding:24px 32px;text-align:center">
    <span style="font-family:Georgia,serif;font-size:24px;font-weight:bold;color:#ffffff">Divine Closet</span>
  </div>
  <div style="padding:32px;background:#ffffff">
    <h1 style="font-size:20px;color:#9E2BBA;margin:0 0 16px">Redefinição de senha</h1>
    <p style="font-size:14px;line-height:1.6;margin:0 0 16px">
      Olá! Recebemos um pedido de redefinição de senha da sua conta.
      Clique no botão abaixo para criar uma nova senha (válido por 1 hora):
    </p>
    <div style="text-align:center;margin:28px 0">
      <a href="${link}" style="display:inline-block;background:#9E2BBA;color:#ffffff;font-size:15px;font-weight:bold;text-decoration:none;padding:14px 36px;border-radius:8px">Clique aqui</a>
    </div>
    <p style="font-size:12px;line-height:1.6;color:#6b7280;margin:0 0 8px">
      Se o botão não funcionar, copie e cole este link no navegador:
    </p>
    <p style="font-size:12px;line-height:1.6;color:#6b7280;margin:0;word-break:break-all">
      <a href="${link}" style="color:#B08D57">${link}</a>
    </p>
    <p style="font-size:12px;line-height:1.6;color:#6b7280;margin:16px 0 0">
      Se não foi você, ignore este e-mail — sua senha permanece a mesma.
    </p>
  </div>
  <div style="background:#f3f4f6;padding:16px 32px;text-align:center;font-size:11px;color:#9ca3af">
    Divine Closet — Moda que eleva o seu dia
  </div>
</div>`,
  }),
};
