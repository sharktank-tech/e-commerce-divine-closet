import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { NextRequest } from "next/server";
import { linkRedeSocial } from "@/lib/redes-sociais";

const { db, auth, revalidar } = vi.hoisted(() => ({
  db: { setting: { findMany: vi.fn(), findUnique: vi.fn(), upsert: vi.fn() }, category: { findMany: vi.fn() }, product: { count: vi.fn() }, $transaction: vi.fn() },
  auth: vi.fn(), revalidar: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/auth", () => ({ requireAuth: auth, forbidden: () => new Response(null, { status: 403 }) }));
vi.mock("next/cache", () => ({ revalidatePath: revalidar }));
import { GET, PUT } from "@/app/api/admin/configuracoes/route";
import { Footer } from "@/components/layout/Footer";

beforeEach(() => {
  vi.clearAllMocks(); auth.mockResolvedValue({ role: "ADMIN" });
  db.setting.findMany.mockResolvedValue([]); db.setting.findUnique.mockResolvedValue(null);
  db.setting.upsert.mockResolvedValue({}); db.$transaction.mockImplementation((ops) => Promise.all(ops));
  db.category.findMany.mockResolvedValue([]); db.product.count.mockResolvedValue(0);
});
const put = (empresa: unknown) => PUT(new NextRequest("https://example.com/api/admin/configuracoes", { method: "PUT", body: JSON.stringify({ empresa }) }));

describe("redes sociais configuráveis", () => {
  it("aceita links da rede e rejeita protocolos e domínios indevidos", () => {
    expect(linkRedeSocial(" https://www.instagram.com/loja/ ", "instagram")).toBe("https://www.instagram.com/loja/");
    for (const v of ["javascript:alert(1)", "http://facebook.com/loja", "https://facebook.com.evil.test/", "https://evil.test/", "https://user:pass@facebook.com/"]) expect(linkRedeSocial(v, "facebook")).toBeNull();
  });
  it("carrega campos vazios em configurações antigas sem perder contatos", async () => {
    db.setting.findMany.mockResolvedValue([{ key: "empresa", value: JSON.stringify({ name: "Loja", email: "loja@example.com" }) }]);
    const data = await (await GET()).json();
    expect(data.settings.empresa).toMatchObject({ name: "Loja", email: "loja@example.com", instagram: "", facebook: "" });
  });
  it("salva links e permite removê-los, invalidando o rodapé", async () => {
    const res = await put({ email: "loja@example.com", instagram: "https://instagram.com/loja", facebook: "" });
    expect(res.status).toBe(200);
    const gravado = JSON.parse(db.setting.upsert.mock.calls[0][0].update.value);
    expect(gravado).toMatchObject({ email: "loja@example.com", instagram: "https://instagram.com/loja", facebook: "" });
    expect(revalidar).toHaveBeenCalledWith("/", "layout");
  });
  it("rejeita link inválido antes de persistir", async () => {
    expect((await put({ instagram: "javascript:alert(1)" })).status).toBe(400);
    expect(db.setting.upsert).not.toHaveBeenCalled();
  });
  it("mantém verificação de acesso existente", async () => {
    auth.mockResolvedValue(null);
    expect((await put({ instagram: "" })).status).toBe(403);
    expect(db.setting.upsert).not.toHaveBeenCalled();
  });
  it("exibe no rodapé somente links válidos cadastrados", async () => {
    db.setting.findUnique.mockResolvedValue({ value: JSON.stringify({ instagram: "https://instagram.com/loja", facebook: "https://facebook.com/loja" }) });
    let html = renderToStaticMarkup(await Footer());
    expect(html).toContain('href="https://instagram.com/loja"'); expect(html).toContain('href="https://facebook.com/loja"');
    expect(html).toContain('rel="noopener noreferrer"');
    db.setting.findUnique.mockResolvedValue({ value: JSON.stringify({ instagram: "", facebook: "javascript:alert(1)" }) });
    html = renderToStaticMarkup(await Footer());
    expect(html).not.toContain('>Instagram<'); expect(html).not.toContain('>Facebook<'); expect(html).not.toContain('javascript:');
  });
});
