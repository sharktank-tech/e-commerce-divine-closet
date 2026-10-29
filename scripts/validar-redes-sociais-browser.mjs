// Usa apenas servidor local com banco descartável; salva e remove perfis fictícios.
// Não executar contra produção. PLAYWRIGHT_MODULE e JOSE_MODULE podem apontar a instalações externas.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const { SignJWT } = require(process.env.JOSE_MODULE || "jose");
const base = process.env.DC_BASE_URL || "http://127.0.0.1:3110";
if (!["127.0.0.1", "localhost"].includes(new URL(base).hostname) || !process.env.DC_TEST_JWT_SECRET) throw new Error("Exige servidor local e secret exclusivo de teste");
const token = await new SignJWT({ sub: "00000000-0000-4000-8000-000000000001", role: "ADMIN", name: "Teste local", email: "teste@example.invalid" }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("10m").sign(new TextEncoder().encode(process.env.DC_TEST_JWT_SECRET));
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE || undefined, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const context = await browser.newContext();
await context.addCookies([{ name: "dc_admin_session", value: token, url: base, httpOnly: true, sameSite: "Lax" }]);
await context.route("**/*", route => new URL(route.request().url()).origin === new URL(base).origin ? route.continue() : route.abort());
const page = await context.newPage();
const expected = { instagram: "https://www.instagram.com/loja_teste/", facebook: "https://www.facebook.com/loja_teste/" };
const results = [];
try {
  await page.goto(`${base}/admin/configuracoes`);
  await page.getByLabel(/^Instagram/).fill(expected.instagram);
  await page.getByLabel(/^Facebook/).fill(expected.facebook);
  const saved = page.waitForResponse(r => r.url().endsWith("/api/admin/configuracoes") && r.request().method() === "PUT");
  await page.getByRole("button", { name: "Salvar tudo", exact: true }).click();
  assert.equal((await saved).status(), 200);
  await page.reload();
  assert.equal(await page.getByLabel(/^Instagram/).inputValue(), expected.instagram);
  assert.equal(await page.getByLabel(/^Facebook/).inputValue(), expected.facebook);
  results.push("admin salva e recarrega os dois links");
  await page.goto(`${base}/contato`);
  const footer = page.locator("footer");
  for (const [rede, label] of [["instagram", "Instagram"], ["facebook", "Facebook"]]) {
    const link = footer.getByRole("link", { name: label, exact: true });
    await link.waitFor();
    assert.equal(await link.getAttribute("href"), expected[rede]);
    assert.equal(await link.getAttribute("target"), "_blank");
    assert((await link.getAttribute("rel")).includes("noopener"));
  }
  results.push("rodapé apresenta os links persistidos");
  const invalid = await context.request.put(`${base}/api/admin/configuracoes`, { data: { empresa: { instagram: "javascript:alert(1)" } } });
  assert.equal(invalid.status(), 400);
  const afterInvalid = await (await context.request.get(`${base}/api/admin/configuracoes`)).json();
  assert.equal(afterInvalid.settings.empresa.instagram, expected.instagram);
  results.push("API rejeita link inseguro sem apagar configuração anterior");
  await page.goto(`${base}/admin/configuracoes`);
  await page.getByLabel(/^Instagram/).fill("");
  await page.getByLabel(/^Facebook/).fill("");
  const cleared = page.waitForResponse(r => r.url().endsWith("/api/admin/configuracoes") && r.request().method() === "PUT");
  await page.getByRole("button", { name: "Salvar tudo", exact: true }).click(); assert.equal((await cleared).status(), 200);
  await page.goto(`${base}/contato`);
  assert.equal(await page.locator("footer").getByRole("link", { name: "Instagram", exact: true }).count(), 0);
  assert.equal(await page.locator("footer").getByRole("link", { name: "Facebook", exact: true }).count(), 0);
  results.push("campos vazios removem os links do rodapé");
  console.log(JSON.stringify({ browser: browser.version(), data: "SINTETICOS", results }, null, 2));
} finally { await context.close(); await browser.close(); }
