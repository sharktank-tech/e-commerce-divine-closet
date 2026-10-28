// Navegador real; respostas de negócio e SDK simulados. Servidor local já iniciado.
// PLAYWRIGHT_MODULE=/caminho/playwright CHROMIUM_EXECUTABLE=/caminho/chromium
// DC_BASE_URL=http://127.0.0.1:3108 node scripts/validar-checkout-browser.mjs
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.DC_BASE_URL || "http://127.0.0.1:3108";
if (!["127.0.0.1", "localhost"].includes(new URL(base).hostname)) throw new Error("Somente servidor local descartável");
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE || undefined, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const address = { id: "addr", label: "Casa", street: "Rua Teste", number: "s/n", complement: null, neighborhood: "Centro", city: "Palmas", state: "TO", zipCode: "77000000", isDefault: true };
const cart = { subtotal: 30, items: [{ id: "item", quantity: 1, lineTotal: 30, unitPrice: 30, aviso: null, product: { id: "produto", name: "Peça", price: 30 } }] };
const results = [];

async function scenario(name, options, check) {
  const context = await browser.newContext();
  const posts = []; const payments = new Map();
  await context.addInitScript(() => { window.dataLayer = []; window.fbq = (...args) => window.dataLayer.push(args); });
  await context.route("**/*", async route => {
    const request = route.request(); const u = new URL(request.url());
    if (u.origin !== new URL(base).origin) {
      if (u.hostname === "sdk.mercadopago.com" && options.sdk !== "fail") return route.fulfill({ contentType: "application/javascript", body: "window.MercadoPago=class {fields={createCardToken:async()=>({id:'token-teste'})};async getPaymentMethods(){return {results:[{id:'visa'}]}}}" });
      return route.abort();
    }
    let data;
    if (u.pathname === "/api/auth/me") data = { user: options.guest ? null : { name: "Teste", email: "teste@example.com" } };
    else if (u.pathname === "/api/carrinho") data = options.emptyAfter && posts.length ? { items: [], subtotal: 0 } : cart;
    else if (u.pathname === "/api/enderecos") data = { addresses: [address] };
    else if (u.pathname === "/api/config-loja") data = { frete: { fixed: 20, freeFrom: 300 }, pagamento: { card: true, pix: true, boleto: false } };
    else if (u.pathname === "/api/frete") data = { delivery: [{ price: 20, eta: "até 10 dias" }] };
    else if (u.pathname === "/api/pagamentos/public-key") {
      if (options.key === "slow") await new Promise(r => setTimeout(r, 5000));
      data = { publicKey: options.key === "absent" ? null : "TEST-public-key" };
    } else if (u.pathname === "/api/pedidos" && request.method() === "POST") {
      posts.push({ body: request.postDataJSON(), key: request.headers()["idempotency-key"] });
      const key = posts.at(-1).key;
      if (!payments.has(key)) payments.set(key, "payment-test");
      if (options.lostResponse && posts.length === 1) return route.abort();
      data = { ok: true, pendente: options.status !== "PAID", replayed: posts.length > 1, order: { number: "DC-TESTE", total: 50, paymentStatus: options.status || "PENDING", status: options.status === "FAILED" ? "CANCELLED" : "PENDING" }, ...(options.qr ? { payment: { qr: { codigo: "pix-teste" } } } : {}) };
    } else return route.continue();
    return route.fulfill({ json: data });
  });
  const page = await context.newPage();
  try {
    await page.goto(`${base}/checkout`);
    if (options.guest) {
      await page.getByLabel("Seu nome", { exact: false }).fill("Pessoa Teste");
      await page.getByLabel("E-mail", { exact: false }).fill("teste@example.com");
    } else await page.getByText(/Comprando como/).waitFor();
    await page.getByRole("button", { name: "Continuar", exact: true }).click();
    if (options.guest) {
      for (const [label, value] of [["Rua", "Rua Teste"], ["Bairro", "Centro"], ["Cidade", "Palmas"], ["UF", "TO"], ["CEP", "77000000"]]) await page.getByLabel(new RegExp(`^${label}`)).fill(value);
    } else await page.getByLabel(/^Rua/).waitFor();
    await page.getByRole("button", { name: "Continuar", exact: true }).click();
    await page.getByRole("heading", { name: "Frete", exact: true }).waitFor();
    await page.getByRole("button", { name: "Continuar", exact: true }).click();
    await page.getByRole("heading", { name: "Pagamento", exact: true }).waitFor();
    if (options.card) {
      for (const [label, value] of [["Nome no cartão", "Pessoa Teste"], ["Número do cartão", "4111111111111111"], ["Validade", "12/30"], ["CVV", "123"]]) await page.getByLabel(new RegExp(`^${label}`)).fill(value);
    } else await page.getByRole("button", { name: "Pix", exact: true }).click();
    await page.getByRole("button", { name: /^Pagar/ }).click();
    await check({ page, posts, payments });
    results.push({ name, ok: true });
  } finally { await context.close(); }
}

try {
  if (process.env.DC_EXPECT_BLOCKED_DRIVER === "1") {
    const context = await browser.newContext();
    await context.route("**/*", route => new URL(route.request().url()).origin === new URL(base).origin ? route.continue() : route.abort());
    const page = await context.newPage(); await page.goto(`${base}/sucesso`);
    const blocked = await page.evaluate(async () => {
      const res = await fetch("/api/pedidos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ address: { street: "Rua Teste", neighborhood: "Centro", city: "Palmas", state: "TO", zipCode: "77000000" }, guest: { email: "teste@example.com" }, payment: { method: "pix" } }) });
      return { status: res.status, data: await res.json() };
    });
    assert.equal(blocked.status, 503); assert(!blocked.data.order);
    console.log(JSON.stringify({ browser: browser.version(), gateway: "BLOQUEADO", endpoint: "REAL_LOCAL", status: blocked.status }));
    await context.close();
  } else {
  for (const [name, opts] of [["chave ausente", { key: "absent" }], ["chave lenta", { key: "slow" }], ["SDK indisponível", { sdk: "fail" }]]) await scenario(name, { ...opts, card: true }, async ({ page, posts }) => { await page.getByText(/Pagamento com cartão indisponível/).waitFor(); assert.equal(posts.length, 0); });
  await scenario("cartão em análise envia só token", { card: true }, async ({ page, posts }) => { await page.getByRole("heading", { name: "Pagamento pendente" }).waitFor(); assert.deepEqual(posts[0].body.payment, { method: "card", cardToken: "token-teste", installments: 1, paymentMethodId: "visa" }); assert(!JSON.stringify(posts).includes("4111111111111111")); });
  await scenario("pagamento aprovado", { card: true, status: "PAID" }, async ({ page }) => { await page.waitForURL(/\/sucesso\?/); await page.getByRole("heading", { name: "Pedido recebido" }).waitFor(); });
  await scenario("Pix com QR", { qr: true }, async ({ page }) => { await page.getByRole("heading", { name: "Pague com Pix" }).waitFor(); await page.getByText("pix-teste", { exact: true }).waitFor(); });
  await scenario("Pix sem QR", {}, async ({ page }) => { await page.getByRole("heading", { name: "Pagamento pendente" }).waitFor(); assert(new URL(page.url()).pathname !== "/sucesso"); });
  await scenario("pagamento encerrado", { status: "FAILED" }, async ({ page }) => { await page.getByText(/Este pedido não está aguardando pagamento/).waitFor(); });
  await scenario("visitante pendente", { guest: true }, async ({ page }) => { await page.getByRole("heading", { name: "Pagamento pendente" }).waitFor(); assert.equal(await page.getByRole("link", { name: "Acompanhar pedido", exact: true }).getAttribute("href"), "/acompanhar"); });
  await scenario("limitação confirmada: refresh com carrinho vazio não recupera QR", { qr: true, emptyAfter: true }, async ({ page }) => { await page.getByRole("heading", { name: "Pague com Pix" }).waitFor(); await page.reload(); await page.waitForURL(/\/carrinho$/); });
  await scenario("retry após resposta perdida", { lostResponse: true }, async ({ page, posts, payments }) => { await page.getByText(/Erro de conexão/).waitFor(); await page.getByRole("button", { name: /^Pagar/ }).click(); await page.getByRole("heading", { name: "Pagamento pendente" }).waitFor(); assert.equal(posts.length, 2); assert(posts[0].key); assert.equal(posts[0].key, posts[1].key); assert.equal(payments.size, 1); });
  const context = await browser.newContext(); const page = await context.newPage();
  await context.route("**/*", route => new URL(route.request().url()).origin === new URL(base).origin ? route.continue() : route.abort());
  await context.addInitScript(() => { window.dataLayer = []; window.fbq = (...args) => window.dataLayer.push(args); });
  await page.goto(`${base}/sucesso?pedido=INVENTADO&total=999999`);
  await page.getByRole("heading", { name: "Pedido recebido" }).waitFor();
  assert(!(await page.evaluate(() => JSON.stringify(window.dataLayer))).includes("purchase"));
  results.push({ name: "URL manipulada não confirma compra", ok: true }); await context.close();
  console.log(JSON.stringify({ browser: browser.version(), provider: "SIMULADO", results }, null, 2));
  }
} finally { await browser.close(); }
