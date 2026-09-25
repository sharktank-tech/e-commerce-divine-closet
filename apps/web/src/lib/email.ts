type SendEmailInput = {
  to: string;
  subject: string;
  html?: string;
  text?: string;
};

/**
 * Mock de e-mail transacional: em dev apenas loga no console.
 * TODO-CLIENTE: SMTP / provedor de e-mail real (Resend, SES, etc.)
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

  // Integração SMTP real pode ser adicionada aqui (nodemailer, resend, etc.)
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
