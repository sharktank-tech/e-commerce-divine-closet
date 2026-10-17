import { beforeEach, describe, expect, it, vi } from "vitest";

// Mocks hoisted: prisma fake + sessão injetável antes do import da rota.
const { prismaMock, getSessionMock } = vi.hoisted(() => {
  const prismaMock = {
    address: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
    user: { update: vi.fn() },
    $transaction: vi.fn(),
  };
  const getSessionMock = vi.fn();
  return { prismaMock, getSessionMock };
});

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/auth", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/auth")>();
  return { ...original, getSession: getSessionMock };
});

import { GET, POST } from "@/app/api/enderecos/route";
import { DELETE, PATCH } from "@/app/api/enderecos/[id]/route";
import { definirPadrao, type DbEnderecos } from "@/lib/enderecos";

function reqCom(body: unknown) {
  return { json: async () => body } as never;
}

const sessao = { sub: "user-1", email: "a@a.com", name: "A", role: "CLIENT" };

const dadosValidos = {
  street: "Rua das Flores",
  number: "",
  neighborhood: "Centro",
  city: "São Paulo",
  state: "sp",
  zipCode: "01310100",
};

beforeEach(() => {
  vi.clearAllMocks();
  // $transaction executa o callback no próprio fake (tx = cliente).
  prismaMock.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
    fn(prismaMock)
  );
  prismaMock.user.update.mockResolvedValue({});
  prismaMock.address.update.mockImplementation(async (args: any) => ({
    id: args.where.id,
    isDefault: args.data?.isDefault,
    ...args.data,
  }));
  prismaMock.address.create.mockImplementation(async (args: any) => ({
    id: "novo-id",
    userId: "user-1",
    isDefault: false,
    ...args.data,
  }));
  getSessionMock.mockResolvedValue(sessao);
});

describe("POST /api/enderecos", () => {
  it("sem sessão → 401", async () => {
    getSessionMock.mockResolvedValue(null);
    const res = await POST(reqCom(dadosValidos));
    expect(res.status).toBe(401);
    expect(prismaMock.address.create).not.toHaveBeenCalled();
  });

  it("primeiro endereço vira padrão automaticamente (transação com lock)", async () => {
    prismaMock.address.findFirst.mockResolvedValue(null);
    prismaMock.address.count.mockResolvedValue(0);

    const res = await POST(reqCom(dadosValidos));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.address.isDefault).toBe(true);

    // lock na linha do usuário → limpa os demais → seta o novo padrão
    expect(prismaMock.user.update).toHaveBeenCalledTimes(1);
    expect(prismaMock.address.updateMany).toHaveBeenCalledWith({
      where: { userId: "user-1", id: { not: "novo-id" } },
      data: { isDefault: false },
    });
    expect(prismaMock.address.update).toHaveBeenCalledWith({
      where: { id: "novo-id" },
      data: { isDefault: true },
    });
  });

  it("número vazio é gravado como s/n", async () => {
    prismaMock.address.findFirst.mockResolvedValue(null);
    prismaMock.address.count.mockResolvedValue(0);

    const res = await POST(reqCom(dadosValidos));
    expect(res.status).toBe(201);
    const createArgs = prismaMock.address.create.mock.calls[0][0];
    expect(createArgs.data.number).toBe("s/n");
    expect(createArgs.data.state).toBe("SP"); // normalizado p/ caixa alta
  });

  it("confirmar o MESMO endereço de novo devolve o existente (sem duplicar)", async () => {
    const existente = { id: "id-1", isDefault: true, number: "s/n", street: "Rua das Flores" };
    prismaMock.address.findFirst.mockResolvedValue(existente);
    prismaMock.address.count.mockResolvedValue(2);

    const res = await POST(reqCom(dadosValidos));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.existente).toBe(true);
    expect(body.address.id).toBe("id-1");
    expect(prismaMock.address.create).not.toHaveBeenCalled();
    expect(prismaMock.$transaction).not.toHaveBeenCalled(); // já padrão: nada a fazer
  });

  it("endereço existente não-padrão confirmado com 'usar como padrão' → vira padrão", async () => {
    const existente = { id: "id-1", isDefault: false };
    prismaMock.address.findFirst.mockResolvedValue(existente);
    prismaMock.address.count.mockResolvedValue(2);

    const res = await POST(reqCom({ ...dadosValidos, isDefault: true }));
    expect(res.status).toBe(200);
    expect(prismaMock.address.create).not.toHaveBeenCalled();
    expect(prismaMock.address.update).toHaveBeenCalledWith({
      where: { id: "id-1" },
      data: { isDefault: true },
    });
  });

  it("endereço já existente não é re-padronizado sem pedido (isDefault ausente)", async () => {
    prismaMock.address.findFirst.mockResolvedValue({ id: "id-1", isDefault: false });
    prismaMock.address.count.mockResolvedValue(3);

    const res = await POST(reqCom(dadosValidos));
    expect(res.status).toBe(200);
    expect(prismaMock.address.update).not.toHaveBeenCalled();
    expect(prismaMock.address.create).not.toHaveBeenCalled();
  });

  it("dados inválidos → 400", async () => {
    const res = await POST(reqCom({ ...dadosValidos, street: "R" }));
    expect(res.status).toBe(400);
    expect(prismaMock.address.create).not.toHaveBeenCalled();
  });
});

describe("GET /api/enderecos", () => {
  it("lista só os endereços da própria sessão (isolamento entre contas)", async () => {
    prismaMock.address.findMany.mockResolvedValue([]);
    const res = await GET(reqCom(null));
    expect(res.status).toBe(200);
    expect(prismaMock.address.findMany).toHaveBeenCalledWith({
      where: { userId: "user-1" },
      orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    });
  });

  it("sem sessão → 401 e nada é consultado", async () => {
    getSessionMock.mockResolvedValue(null);
    const res = await GET(reqCom(null));
    expect(res.status).toBe(401);
    expect(prismaMock.address.findMany).not.toHaveBeenCalled();
  });
});

const params = (id: string) => ({ params: Promise.resolve({ id }) });

describe("PATCH/DELETE /api/enderecos/[id] (posse)", () => {
  it("endereço de OUTRA conta → 404 e não altera", async () => {
    prismaMock.address.findUnique.mockResolvedValue({ id: "id-x", userId: "outra-conta" });

    const patch = await PATCH(reqCom({ street: "Hack" }), params("id-x"));
    expect(patch.status).toBe(404);
    expect(prismaMock.address.update).not.toHaveBeenCalled();

    const del = await DELETE(reqCom(null), params("id-x"));
    expect(del.status).toBe(404);
    expect(prismaMock.address.delete).not.toHaveBeenCalled();
  });

  it("endereço inexistente → 404", async () => {
    prismaMock.address.findUnique.mockResolvedValue(null);
    const res = await PATCH(reqCom({ street: "X" }), params("nope"));
    expect(res.status).toBe(404);
  });

  it("sem sessão → 401", async () => {
    getSessionMock.mockResolvedValue(null);
    const res = await PATCH(reqCom({ street: "X" }), params("id-x"));
    expect(res.status).toBe(401);
  });

  it("tornar padrão: limpa os demais na MESMA transação (só um padrão)", async () => {
    prismaMock.address.findUnique.mockResolvedValue({ id: "id-1", userId: "user-1" });

    const res = await PATCH(reqCom({ isDefault: true }), params("id-1"));
    expect(res.status).toBe(200);
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(prismaMock.address.updateMany).toHaveBeenCalledWith({
      where: { userId: "user-1", id: { not: "id-1" } },
      data: { isDefault: false },
    });
    expect(prismaMock.user.update).toHaveBeenCalledTimes(1); // lock do usuário
  });

  it("isDefault=false não toca nos demais endereços", async () => {
    prismaMock.address.findUnique.mockResolvedValue({ id: "id-1", userId: "user-1" });

    const res = await PATCH(reqCom({ isDefault: false, street: "Nova" }), params("id-1"));
    expect(res.status).toBe(200);
    expect(prismaMock.address.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.address.update).toHaveBeenCalledTimes(1); // só os campos
  });
});

describe("definirPadrao (regra atômica)", () => {
  it("ordem: lock do usuário → limpa os demais → seta o alvo", async () => {
    const chamadas: string[] = [];
    const fake = {
      user: {
        update: vi.fn(async () => {
          chamadas.push("lock");
          return {};
        }),
      },
      address: {
        updateMany: vi.fn(async () => {
          chamadas.push("limpa");
          return {};
        }),
        update: vi.fn(async (args: any) => {
          chamadas.push("seta");
          return { id: args.where.id, isDefault: args.data.isDefault };
        }),
      },
      $transaction: vi.fn(),
    } as unknown as DbEnderecos;

    const r = await definirPadrao(fake, "user-1", "addr-9");
    expect(chamadas).toEqual(["lock", "limpa", "seta"]);
    expect(r).toEqual({ id: "addr-9", isDefault: true });
  });

  it("padrao=false: lock + desmarcar o alvo (sem limpar os outros)", async () => {
    const fake = {
      user: { update: vi.fn(async () => ({})) },
      address: {
        updateMany: vi.fn(),
        update: vi.fn(async (args: any) => ({ id: args.where.id, isDefault: args.data.isDefault })),
      },
      $transaction: vi.fn(),
    } as unknown as DbEnderecos;

    const r = await definirPadrao(fake, "user-1", "addr-9", false);
    expect(fake.address.updateMany).not.toHaveBeenCalled();
    expect(r.isDefault).toBe(false);
  });
});
