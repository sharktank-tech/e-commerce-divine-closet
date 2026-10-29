import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE);
const { PrismaClient } = require(process.env.PRISMA_MODULE);
const { SignJWT } = await import(process.env.JOSE_MODULE);
const base = process.env.DC_BASE_URL || "http://127.0.0.1:3114";
if (
  !["127.0.0.1", "localhost"].includes(new URL(base).hostname) ||
  !/^postgresql:\/\/[^@]*@(?:localhost|127\.0\.0\.1):/.test(
    process.env.DATABASE_URL || "",
  )
)
  throw Error("Somente ambiente local descartável");
const db = new PrismaClient();
let checks = 0;
const ok = (v, label) => {
  assert.ok(v, label);
  checks++;
  console.log(`PASS ${label}`);
};
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE,
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
try {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  const external = [];
  await context.route("**/*", (route) => {
    const u = new URL(route.request().url());
    if (u.origin === base) return route.continue();
    external.push(u.hostname);
    return route.fulfill({
      status: 200,
      body: "",
      contentType: "application/javascript",
    });
  });
  const page = await context.newPage();
  await page.goto(
    `${base}/contato?utm_source=instagram&utm_medium=social&utm_campaign=teste`,
  );
  await page.getByRole("button", { name: "Recusar", exact: true }).click();
  const email = `browser-${Date.now()}@example.invalid`;
  await page.getByLabel("Seu e-mail", { exact: true }).fill(email);
  await page.getByLabel("Quero receber novidades e ofertas").check();
  await page
    .getByRole("button", { name: "Quero receber", exact: true })
    .click();
  await page.getByRole("status").filter({ hasText: "Se o endereço" }).waitFor();
  const s = await db.newsletterSubscriber.findUniqueOrThrow({
    where: { email },
  });
  ok(
    s.status === "pending",
    "formulário cria inscrição pendente no PostgreSQL",
  );
  const mail = await db.marketingMessage.findFirstOrThrow({
    where: { subscriberId: s.id, kind: "CONFIRM" },
  });
  const link = mail.text.match(/http[^\s]+/)[0];
  await page.goto(link.replace("http://127.0.0.1:3114", base));
  ok(
    (await db.newsletterSubscriber.findUniqueOrThrow({ where: { id: s.id } }))
      .status === "pending",
    "GET confirmação não altera estado",
  );
  ok(
    await page
      .locator('meta[name="robots"]')
      .getAttribute("content")
      .then((s) => s.includes("noindex")),
    "página privada noindex",
  );
  await page
    .getByRole("button", { name: "Confirmar inscrição", exact: true })
    .click();
  await page
    .getByRole("status")
    .filter({ hasText: "Inscrição confirmada" })
    .waitFor();
  ok(
    (await db.newsletterSubscriber.findUniqueOrThrow({ where: { id: s.id } }))
      .status === "confirmed",
    "POST confirma posse e inscrição",
  );
  const token = await new SignJWT({
    sub: "00000000-0000-4000-8000-000000000001",
    email: "admin@example.invalid",
    name: "Teste",
    role: "ADMIN",
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(process.env.JWT_SECRET));
  await context.addCookies([
    {
      name: "dc_admin_session",
      value: token,
      url: base,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  await page.goto(`${base}/admin/marketing/campanhas`);
  await page.getByLabel("Assunto", { exact: true }).fill("Campanha browser");
  await page
    .getByLabel("Conteúdo (texto simples)", { exact: true })
    .fill("Texto de campanha <script>não executar</script>");
  ok(
    await page
      .locator("pre")
      .first()
      .innerText()
      .then((s) => s.includes("<script>")),
    "prévia exibe HTML como texto seguro",
  );
  await page
    .getByRole("button", { name: "Salvar rascunho", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Campanha browser", exact: true })
    .waitFor();
  const c = await db.marketingCampaign.findFirstOrThrow({
    where: { subject: "Campanha browser" },
  });
  ok(c.status === "DRAFT", "admin salva campanha no banco");
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Confirmar enfileiramento" }).click();
  await page.waitForResponse(
    (r) =>
      r.url().includes("/api/admin/marketing/campanhas") &&
      r.request().method() === "POST",
  );
  ok(
    (await db.marketingMessage.count({ where: { campaignId: c.id } })) === 1,
    "enfileiramento cria um destinatário elegível",
  );
  page.once("dialog", (d) => d.accept());
  await page
    .getByRole("button", { name: "Processar lote de até 10 mensagens" })
    .click();
  await page.getByRole("status").filter({ hasText: "Simulação" }).waitFor();
  ok(
    (await db.marketingMessage.count({ where: { status: "ACCEPTED" } })) === 0,
    "mock preserva fila sem falsa aceitação",
  );
  const promotional = await db.marketingMessage.findFirstOrThrow({
    where: { campaignId: c.id },
  });
  const unsub = promotional.text.match(/http[^\s]+/)[0];
  await page.goto(unsub);
  ok(
    (await db.newsletterSubscriber.findUniqueOrThrow({ where: { id: s.id } }))
      .status === "confirmed",
    "GET descadastro não cancela",
  );
  await page
    .getByRole("button", { name: "Confirmar cancelamento", exact: true })
    .click();
  await page
    .getByRole("status")
    .filter({ hasText: "Inscrição cancelada" })
    .waitFor();
  ok(
    (await db.newsletterSubscriber.findUniqueOrThrow({ where: { id: s.id } }))
      .status === "unsubscribed",
    "descadastro por POST funciona",
  );
  await page.goto(`${base}/admin/marketing`);
  await page
    .getByRole("heading", { name: "Indicadores de Marketing e Vendas" })
    .waitFor();
  ok(
    (await page.getByText("Receita após estornos", { exact: true }).count()) ===
      1,
    "indicadores renderizam resposta real da API",
  );
  const anonymous = await browser.newContext();
  const api = await anonymous.request.get(
    `${base}/api/admin/marketing/indicadores`,
  );
  ok([401, 403].includes(api.status()), "API de indicadores nega visitante");
  await page.screenshot({path:"/tmp/dc-marketing-core-browser.png",fullPage:true});
  await anonymous.close();
  console.log(JSON.stringify({checks,browser:browser.version(),externalTransport:"interceptado; nenhum envio real"}));
} finally {
  await browser.close();
  await db.$disconnect();
}
