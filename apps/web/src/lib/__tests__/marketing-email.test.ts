import { beforeEach, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";
const m = vi.hoisted(() => ({
  auth: vi.fn(),
  send: vi.fn(),
  driver: vi.fn(),
  audit: vi.fn(),
  limit: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({
  requireAuth: m.auth,
  forbidden: () => new Response(null, { status: 403 }),
}));
vi.mock("@/lib/prisma", () => ({ prisma: { auditLog: { create: m.audit } } }));
vi.mock("@/lib/rate-limit", () => ({ consumirRateLimit: m.limit }));
vi.mock("@/lib/email", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  sendEmail: m.send,
  emailDriverAtual: m.driver,
}));
import { POST } from "@/app/api/admin/marketing/email/route";
import { EmailNaoAceito } from "@/lib/email";
const request = (
  body: unknown = {
    to: "test@example.invalid",
    subject: "Teste",
    body: "Mensagem de teste",
  },
) =>
  new NextRequest("http://localhost/api/admin/marketing/email", {
    method: "POST",
    body: JSON.stringify(body),
  });
beforeEach(() => {
  vi.clearAllMocks();
  m.auth.mockResolvedValue({ sub: "admin" });
  m.limit.mockResolvedValue({ permitido: true });
  m.driver.mockReturnValue("mock");
  m.send.mockResolvedValue({});
  m.audit.mockResolvedValue({});
});
it("mock diferencia simulação sem alegar entrega", async () => {
  const r = await POST(request());
  expect((await r.json()).status).toBe("mock");
  expect(m.send).not.toHaveBeenCalled();
  expect(m.audit.mock.calls[0][0].data.meta).not.toHaveProperty("body");
});
it("aceitação do provedor não é entrega", async () => {
  m.driver.mockReturnValue("resend");
  m.send.mockResolvedValue({ id: "fake" });
  const d = await (await POST(request())).json();
  expect(d.status).toBe("accepted");
  expect(d.message).toContain("não garante entrega");
});
it("falha sanitizada não expõe erro do provedor e é auditada", async () => {
  m.driver.mockReturnValue("resend");
  m.send.mockRejectedValue(
    new EmailNaoAceito("secret-token-should-not-leak", false),
  );
  const r = await POST(request());
  expect(r.status).toBe(502);
  expect(JSON.stringify(await r.json())).not.toContain("secret-token");
  expect(m.audit.mock.calls[0][0].data.meta.status).toBe("failed");
});
it("sem admin, limite e payload inválido não enviam", async () => {
  m.auth.mockResolvedValueOnce(null);
  expect((await POST(request())).status).toBe(403);
  m.limit.mockResolvedValueOnce({ permitido: false });
  expect((await POST(request())).status).toBe(429);
  expect((await POST(request({ to: "invalid" }))).status).toBe(400);
  expect(m.send).not.toHaveBeenCalled();
});
