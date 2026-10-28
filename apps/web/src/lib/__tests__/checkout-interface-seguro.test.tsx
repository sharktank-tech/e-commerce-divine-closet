// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import CheckoutPage from "@/app/checkout/page";

const { router } = vi.hoisted(() => ({ router: { push: vi.fn(), replace: vi.fn() } }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/lib/analytics", () => ({ analytics: { beginCheckout: vi.fn() } }));

const address = { id: "addr", label: "Casa", street: "Rua Teste", number: "s/n", complement: null, neighborhood: "Centro", city: "Palmas", state: "TO", zipCode: "77000000", isDefault: true };
const response = (data: unknown) => ({ ok: true, status: 200, json: async () => data });
let checkoutResponse: unknown;
let keyResponse: unknown;
let keyLenta: boolean;
let requests: Array<{ url: string; body?: string }>;

beforeEach(() => {
  sessionStorage.clear();
  router.push.mockReset(); router.replace.mockReset();
  requests = [];
  keyResponse = { publicKey: null };
  keyLenta = false;
  checkoutResponse = { ok: true, pendente: true, order: { number: "DC-TESTE", total: 50, paymentStatus: "PENDING" } };
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    requests.push({ url, body: init?.body as string | undefined });
    if (url === "/api/carrinho") return response({ subtotal: 30, items: [{ id: "item", quantity: 1, lineTotal: 30, unitPrice: 30, aviso: null, product: { id: "produto", name: "Peça", price: 30 } }] });
    if (url === "/api/auth/me") return response({ user: { name: "Teste", email: "teste@example.com" } });
    if (url === "/api/enderecos") return response({ addresses: [address] });
    if (url === "/api/config-loja") return response({ frete: { fixed: 20, freeFrom: 300 }, pagamento: { card: true, pix: true, boleto: false } });
    if (url === "/api/pagamentos/public-key") return keyLenta ? new Promise<never>(() => {}) : response(keyResponse);
    if (url.startsWith("/api/frete?")) return response({ delivery: [{ price: 20, eta: "até 10 dias" }] });
    if (url === "/api/pedidos") return response(checkoutResponse);
    throw new Error(`fetch inesperado: ${url}`);
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); delete window.MercadoPago; });

async function abrirPagamento() {
  render(<CheckoutPage />);
  await screen.findByText(/Comprando como/);
  fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
  await screen.findByDisplayValue("Rua Teste");
  fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
  await screen.findByRole("heading", { name: "Frete" });
  await waitFor(() => expect((screen.getByRole("button", { name: "Continuar" }) as HTMLButtonElement).disabled).toBe(false), { timeout: 4000 });
  fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
  await screen.findByRole("heading", { name: "Pagamento" });
}

function preencherCartao() {
  fireEvent.change(screen.getByLabelText(/Nome no cartão/), { target: { value: "Pessoa Teste" } });
  fireEvent.change(screen.getByLabelText(/Número do cartão/), { target: { value: "4111111111111111" } });
  fireEvent.change(screen.getByLabelText(/Validade/), { target: { value: "12/30" } });
  fireEvent.change(screen.getByLabelText(/CVV/), { target: { value: "123" } });
}

function sdkSimulado() {
  keyResponse = { publicKey: "TEST-public-key" };
  window.MercadoPago = class {
    fields = { createCardToken: async () => ({ id: "token-teste" }) };
    async getPaymentMethods() { return { results: [{ id: "visa" }] }; }
  };
}

describe("checkout no navegador isolado", () => {
  it("não envia cartão bruto quando chave/SDK estão indisponíveis", async () => {
    await abrirPagamento();
    preencherCartao();
    fireEvent.click(screen.getByRole("button", { name: /^Pagar/ }));
    await screen.findByText(/Pagamento com cartão indisponível/);
    expect(requests.filter(r => r.url === "/api/pedidos")).toHaveLength(0);
    expect(JSON.stringify(requests)).not.toContain("4111111111111111");
  });
  it("bloqueia cartão enquanto a chave ainda está carregando", async () => {
    keyLenta = true;
    await abrirPagamento(); preencherCartao();
    fireEvent.click(screen.getByRole("button", { name: /^Pagar/ }));
    await screen.findByText(/Pagamento com cartão indisponível/);
    expect(requests.filter(r => r.url === "/api/pedidos")).toHaveLength(0);
  });
  it("cartão em análise envia somente token e permanece pendente", async () => {
    sdkSimulado();
    await abrirPagamento(); preencherCartao();
    fireEvent.click(screen.getByRole("button", { name: /^Pagar/ }));
    await screen.findByRole("heading", { name: "Pagamento pendente" });
    expect(screen.getByText(/pagamento está em análise/)).toBeTruthy();
    expect(router.push).not.toHaveBeenCalled();
    const payload = JSON.parse(requests.find(r => r.url === "/api/pedidos")!.body!);
    expect(payload.payment).toEqual({ method: "card", cardToken: "token-teste", installments: 1, paymentMethodId: "visa" });
    expect(JSON.stringify(payload)).not.toContain("4111111111111111");
  });
  it("pagamento aprovado encaminha para a página de pedido recebido", async () => {
    sdkSimulado();
    checkoutResponse = { ok: true, pendente: false, order: { number: "DC-TESTE", total: 50, paymentStatus: "PAID" } };
    await abrirPagamento(); preencherCartao();
    fireEvent.click(screen.getByRole("button", { name: /^Pagar/ }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/sucesso?pedido=DC-TESTE&total=50"));
  });
  it("mostra Pix pendente sem QR e não navega para sucesso", async () => {
    await abrirPagamento();
    fireEvent.click(screen.getByRole("button", { name: "Pix" }));
    fireEvent.click(screen.getByRole("button", { name: /^Pagar/ }));
    await screen.findByRole("heading", { name: "Pagamento pendente" });
    expect(screen.getByText(/código Pix não está disponível/)).toBeTruthy();
    expect(router.push).not.toHaveBeenCalled();
    const pedido = requests.find(r => r.url === "/api/pedidos");
    expect(JSON.parse(pedido!.body!).payment).toEqual({ method: "pix" });
  });
  it("mostra QR para Pix pendente e não navega para sucesso", async () => {
    checkoutResponse = { ok: true, pendente: true, order: { number: "DC-TESTE", total: 50, paymentStatus: "PENDING" }, payment: { qr: { codigo: "pix-teste" } } };
    await abrirPagamento();
    fireEvent.click(screen.getByRole("button", { name: "Pix" }));
    fireEvent.click(screen.getByRole("button", { name: /^Pagar/ }));
    await screen.findByRole("heading", { name: "Pague com Pix" });
    expect(screen.getByText("pix-teste")).toBeTruthy();
    expect(router.push).not.toHaveBeenCalled();
  });
});
