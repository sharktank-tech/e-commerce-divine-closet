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
  passwordReset: (token: string) => ({
    subject: "Redefinir senha - Divine Closet",
    text: `Use o link para redefinir sua senha: ${process.env.NEXT_PUBLIC_APP_URL}/reset?token=${token}`,
  }),
};
