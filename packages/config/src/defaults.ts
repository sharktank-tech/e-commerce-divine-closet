/**
 * Configurações centralizadas do Divine Closet.
 * TODO-CLIENTE: substituir defaults por valores reais conforme checklist.
 */

export const storeConfig = {
  name: process.env.NEXT_PUBLIC_STORE_NAME || "Divine Closet",
  url: process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
};

/** Identidade visual temporário — trocar quando manual de marca chegar. */
// TODO-CLIENTE: logotipo + manual de marca
export const theme = {
  primary: "#1F3864",
  accent: "#B08D57",
  font: "Inter",
};

/** Frete temporário — tabela fixa até transportadora real. */
// TODO-CLIENTE: transportadora/regras de frete reais
export const shipping = {
  fixed: 20,
  freeFrom: 300,
};

/** Pagamento sandbox até gateway real. */
// TODO-CLIENTE: gateway de pagamento + credenciais
export const payment = {
  driver: process.env.PAYMENT_DRIVER || "mock",
  methods: ["card", "pix", "boleto"] as const,
  sandboxHint: "Ambiente sandbox — nenhuma cobrança real é feita.",
};

/** E-mail transacional em log até SMTP real. */
// TODO-CLIENTE: SMTP / provedor de e-mail
export const email = {
  driver: process.env.EMAIL_DRIVER || "mock",
  from: process.env.EMAIL_FROM || "Divine Closet <no-reply@divinecloset.com>",
};

/** Upload local em dev; S3/MinIO em produção. */
// TODO-CLIENTE: credenciais AWS/S3 ou MinIO
export const upload = {
  driver: process.env.UPLOAD_DRIVER || "local",
  maxBytes: 5 * 1024 * 1024,
  allowedTypes: ["image/jpeg", "image/png", "image/webp", "image/avif", "image/gif"],
};

/** Pixels de rastreamento — vazios até contas Google/Meta. */
// TODO-CLIENTE: Meta Pixel, Google Ads, GA4
export const pixels = {
  metaPixelId: "",
  googleAdsId: "",
  ga4Id: "",
};

export const features = {
  wishlist: true, // estrutura pronta — definir false para desativar (seção 3.5)
  socialLogin: false,
  invoiceEmission: false, // emissor fiscal pendente
  emailMarketing: false,
};

export const stockAlertThreshold = 5;

/** Textos institucionais placeholder. */
export const institutional = {
  about:
    "[TEXTO PENDENTE DO CLIENTE] A Divine Closet nasceu para valorizar a mulher contemporânea com peças selecionadas, caimento impecável e atendimento de qualidade.",
  exchangePolicy:
    "[TEXTO PENDENTE DO CLIENTE] Trocas e devoluções em até 30 dias após o recebimento, com produto sem sinais de uso.",
  privacy:
    "[TEXTO PENDENTE DO CLIENTE] Política de privacidade e tratamento de dados pessoais (LGPD).",
  faq: [
    {
      q: "Qual o prazo de entrega?",
      a: "[TEXTO PENDENTE DO CLIENTE] Prazo padrão de 5 a 10 dias úteis após a confirmação do pagamento.",
    },
    {
      q: "Como faço para trocar uma peça?",
      a: "[TEXTO PENDENTE DO CLIENTE] Solicite a troca em até 30 dias pelo e-mail de atendimento.",
    },
    {
      q: "Quais formas de pagamento são aceitas?",
      a: "Cartão, Pix e boleto (sandbox em ambiente de desenvolvimento).",
    },
  ],
  contact: {
    email: "contato@divinecloset.com",
    phone: "(11) 3000-0000",
    whatsapp: "(11) 99999-0000",
    address: "[TEXTO PENDENTE DO CLIENTE] Rua Exemplo, 100 — São Paulo/SP",
  },
};
