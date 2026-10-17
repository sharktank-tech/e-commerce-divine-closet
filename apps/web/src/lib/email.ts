import nodemailer from "nodemailer";
import { Resend } from "resend";
import { orderStatusLabel } from "@/lib/utils";

export type SendEmailInput = {
  to: string;
  subject: string;
  html?: string;
  text?: string;
  /**
   * Chave de idempotência (Resend: header Idempotency-Key, janela de 24h).
   * Com o payload IMUTÁVEL do outbox, repetir a mesma chave é seguro:
   * tentativa incerta (rede/timeout) não duplica o e-mail.
   */
  idempotencyKey?: string;
};

/** Resultado do envio: resolvido = ACEITO pelo provedor. */
export type ResultadoEnvio = { id?: string };

/**
 * Provedor não aceitou (ou aceitou condicionalmente). `retryable` decide se o
 * outbox repete com backoff (rede/429/5xx) ou marca FAILED (configuração,
 * validação, chave idempotente incompatível).
 */
export class EmailNaoAceito extends Error {
  constructor(message: string, public readonly retryable: boolean) {
    super(message);
    this.name = "EmailNaoAceito";
  }
}

/**
 * E-mail transacional.
 * - EMAIL_DRIVER=mock   → apenas loga no console (dev sem credenciais)
 * - EMAIL_DRIVER=smtp   → envio via SMTP (Zoho Mail; bloqueado a partir da Vercel)
 * - EMAIL_DRIVER=resend → envio via API Resend (produção; funciona de qualquer IP)
 */
export async function sendEmail(input: SendEmailInput): Promise<ResultadoEnvio> {
  const driver = process.env.EMAIL_DRIVER || "mock";

  if (driver === "mock") {
    console.log("────────────────────────────────────────");
    console.log("[EMAIL MOCK]");
    console.log(`De: ${process.env.EMAIL_FROM || "Divine Closet"}`);
    console.log(`Para: ${input.to}`);
    console.log(`Assunto: ${input.subject}`);
    console.log(input.text || stripHtml(input.html || ""));
    console.log("────────────────────────────────────────");
    return {};
  }

  if (driver === "smtp") {
    const host = process.env.SMTP_HOST;
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    if (!host || !user || !pass) {
      throw new EmailNaoAceito(
        "SMTP não configurado (defina SMTP_HOST, SMTP_USER e SMTP_PASS).",
        false
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

    try {
      // SMTP não participa do Resend Idempotency-Key: sem chave, a
      // repetição pode duplicar (limitação documentada no doc de pendências).
      await transporter.sendMail({
        from: process.env.EMAIL_FROM || user,
        to: input.to,
        subject: input.subject,
        text: input.text,
        html: input.html,
      });
      return {};
    } catch (err) {
      // Erro de SMTP é tratado como transitório: vale retentar (rede/servidor).
      throw new EmailNaoAceito(
        `SMTP: ${(err as Error).message}`,
        true
      );
    }
  }

  if (driver === "resend") {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      throw new EmailNaoAceito(
        "Resend não configurado (defina RESEND_API_KEY).",
        false
      );
    }

    const resend = new Resend(apiKey);
    const base = {
      from: process.env.EMAIL_FROM || "Divine Closet <no-reply@divinecloset.com.br>",
      to: input.to,
      subject: input.subject,
    };
    const payload = input.html
      ? { ...base, html: input.html }
      : { ...base, text: input.text ?? "" };

    let resposta;
    try {
      resposta = await resend.emails.send(
        payload,
        input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : undefined
      );
    } catch (err) {
      // Falha de rede/SDK sem resposta HTTP: transitória.
      throw new EmailNaoAceito(`Resend: ${(err as Error).message}`, true);
    }

    const { data, error } = resposta;
    if (error) {
      // 4xx determinístico (validação/config/chave) não resolve repetindo;
      // rede implícita (statusCode null), 408/429/5xx e concorrência na mesma
      // chave sim — o outbox repete com a MESMA chave (dedupeKey imutável).
      const s = error.statusCode;
      const transitorio =
        error.name === "concurrent_idempotent_requests" ||
        error.name === "rate_limit_exceeded" ||
        error.name === "internal_server_error" ||
        error.name === "application_error" ||
        s === null ||
        s === 408 ||
        s === 429 ||
        s >= 500;
      throw new EmailNaoAceito(`Resend: ${error.message}`, transitorio);
    }
    return { id: data?.id };
  }

  throw new EmailNaoAceito(`Driver de e-mail não suportado: ${driver}`, false);
}

function stripHtml(html: string) {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

export const emails = {
  welcome: (name: string) => ({
    subject: "Bem-vinda(o) à Divine Closet 💫",
    text: `Olá ${name}, sua conta foi criada com sucesso. Bom shopping!`,
  }),
  orderPaid: (number: string, linkAcompanhar?: string | null) => ({
    subject: `Pedido ${number} pago com sucesso`,
    text: [
      `Pagamento confirmado para o pedido ${number}. Estamos preparando seu envio.`,
      ...(linkAcompanhar
        ? [
            "",
            "Acompanhe seu pedido:",
            linkAcompanhar,
            "",
            "Guarde este e-mail — o link é privado.",
          ]
        : []),
    ].join("\n"),
  }),
  // E-mail por STATUS REAL do pedido — disparado quando o status muda
  // (admin, reconciliação Pix, cancelamento) ou quando o rastreio é
  // divulgado pela 1ª vez. Anti-duplicado na chamada (deveNotificarStatus).
  statusPedido: (
    number: string,
    status: string,
    opts: {
      link?: string | null;
      linkNota?: string | null;
      tracking?: {
        codigo: string;
        transportadora?: string | null;
        url?: string | null;
      } | null;
    } = {}
  ) => {
    const label = orderStatusLabel(status);
    const frases: Record<string, string> = {
      PENDING: "Aguardando a confirmação do pagamento.",
      PAID: "Pagamento confirmado — estamos preparando seu envio.",
      PROCESSING: "Seu pedido está em preparação.",
      SHIPPED: "Seu pedido foi enviado!",
      DELIVERED: "Seu pedido foi entregue. Obrigado por comprar com a gente!",
      CANCELLED: "Seu pedido foi cancelado.",
      REFUNDED:
        "Seu pedido foi estornado — o valor volta conforme o prazo da sua forma de pagamento.",
    };
    const frasesTracked: Record<string, string> = {
      SHIPPED: "Seu pedido foi enviado e já pode ser rastreado:",
    };
    const frase =
      frasesTracked[status] || frases[status] || `Status do pedido: ${label}.`;
    const linhas = [
      `Pedido ${number} — ${label}`,
      "",
      frase,
      ...(opts.tracking
        ? [
            "",
            `Rastreio: ${opts.tracking.codigo}` +
              (opts.tracking.transportadora
                ? ` (${opts.tracking.transportadora})`
                : ""),
            ...(opts.tracking.url ? [opts.tracking.url] : []),
          ]
        : []),
      ...(opts.link ? ["", "Acompanhe seu pedido:", opts.link] : []),
      ...(opts.linkNota ? ["", opts.linkNota] : []),
    ];
    const botao = opts.link
      ? `<p style="margin:24px 0"><a href="${opts.link}" style="display:inline-block;background:#9E2BBA;color:#ffffff;font-size:14px;font-weight:bold;text-decoration:none;padding:12px 28px;border-radius:8px">Acompanhar pedido</a></p>`
      : "";
    const blocoTracking = opts.tracking
      ? `<p style="font-size:14px;margin:0 0 8px"><strong>Rastreio:</strong> ${opts.tracking.codigo}${
          opts.tracking.transportadora ? ` (${opts.tracking.transportadora})` : ""
        }</p>` +
        (opts.tracking.url
          ? `<p style="font-size:13px;margin:0 0 8px"><a href="${opts.tracking.url}" style="color:#B08D57">${opts.tracking.url}</a></p>`
          : "")
      : "";
    const blocoNota = opts.linkNota
      ? `<p style="font-size:12px;color:#6b7280">${opts.linkNota}</p>`
      : "";
    const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;color:#1f2937">
  <div style="background:#9E2BBA;padding:24px 32px;text-align:center">
    <span style="font-family:Georgia,serif;font-size:24px;font-weight:bold;color:#ffffff">Divine Closet</span>
  </div>
  <div style="padding:32px;background:#ffffff">
    <h1 style="font-size:20px;color:#9E2BBA;margin:0 0 16px">Pedido ${number}: ${label}</h1>
    <p style="font-size:14px;line-height:1.6;margin:0 0 12px">${frase}</p>
    ${blocoTracking}
    ${botao}
    ${blocoNota}
  </div>
  <div style="background:#f3f4f6;padding:16px 32px;text-align:center;font-size:11px;color:#9ca3af">
    Divine Closet — Moda que eleva o seu dia
  </div>
</div>`;
    return { subject: `Pedido ${number}: ${label}`, text: linhas.join("\n"), html };
  },
  acompanharPedidos: (links: { numero: string; url: string }[]) => ({
    subject: "Links de acompanhamento dos seus pedidos",
    text: [
      "Olá!",
      "",
      "Novos links para acompanhar seus pedidos (válidos por 30 dias):",
      ...links.map((l) => `• Pedido ${l.numero}: ${l.url}`),
      "",
      "Guarde este e-mail — os links são privados.",
    ].join("\n"),
  }),
  reviewRequest: (orderNumber: string, items: { name: string; url: string }[]) => ({    subject: `Como foi sua compra ${orderNumber}? Conte pra gente 💫`,
    text: [
      "Olá!",
      "",
      `Seu pedido ${orderNumber} foi entregue. Que tal avaliar as peças? Sua opinião ajuda outras clientes:`,
      ...items.map((i) => `• ${i.name}: ${i.url}`),
      "",
      "Obrigado por comprar na Divine Closet!",
    ].join("\n"),
    html: `<div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;color:#1f2937">
  <div style="background:#9E2BBA;padding:24px 32px;text-align:center">
    <span style="font-family:Georgia,serif;font-size:24px;font-weight:bold;color:#ffffff">Divine Closet</span>
  </div>
  <div style="padding:32px;background:#ffffff">
    <h1 style="font-size:20px;color:#9E2BBA;margin:0 0 16px">Como foi sua compra?</h1>
    <p style="font-size:14px;line-height:1.6;margin:0 0 16px">Seu pedido <strong>${orderNumber}</strong> foi entregue. Avalie as peças e ajude outras clientes:</p>
    ${items
      .map(
        (i) =>
          `<p style="margin:0 0 12px"><a href="${i.url}" style="display:inline-block;background:#9E2BBA;color:#ffffff;font-size:14px;font-weight:bold;text-decoration:none;padding:12px 28px;border-radius:8px">Avaliar: ${i.name}</a></p>`
      )
      .join("")}
    <p style="font-size:12px;color:#6b7280;margin:16px 0 0">Obrigado por comprar na Divine Closet!</p>
  </div>
</div>`,
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
  carrinhoAbandonado: (
    name: string,
    items: { name: string; quantity: number }[],
    linkCarrinho: string
  ) => ({
    subject: "Seu carrinho te espera 🛍️",
    text: [
      `Olá ${name}!`,
      "",
      "Você deixou estes itens no carrinho:",
      ...items.map((i) => `• ${i.quantity}× ${i.name}`),
      "",
      `Retome aqui: ${linkCarrinho}`,
      "",
      "Obrigado por comprar na Divine Closet!",
    ].join("\n"),
  }),
};
