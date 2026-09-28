import { describe, expect, it } from "vitest";
import { excludeUsed, shouldShow, takeFresh } from "../home";

const a = { id: "a" };
const b = { id: "b" };
const c = { id: "c" };

describe("excludeUsed", () => {
  it("remove ids já exibidos", () => {
    expect(excludeUsed([a, b, c], new Set(["b"]))).toEqual([a, c]);
  });

  it("não muta a lista original", () => {
    const list = [a, b];
    excludeUsed(list, new Set(["a"]));
    expect(list).toEqual([a, b]);
  });
});

describe("takeFresh", () => {
  it("pega até n e marca como usados", () => {
    const used = new Set<string>();
    expect(takeFresh([a, b, c], used, 2)).toEqual([a, b]);
    expect([...used]).toEqual(["a", "b"]);
    expect(takeFresh([a, b, c], used, 8)).toEqual([c]);
  });
});

describe("shouldShow", () => {
  it("exige ao menos 4 itens", () => {
    expect(shouldShow([a, b, c])).toBe(false);
    expect(shouldShow([a, b, c, { id: "d" }])).toBe(true);
  });
});
