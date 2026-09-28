"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useCart } from "./CartProvider";
import { Button } from "@/components/ui/Button";
import { ordenarTamanhos } from "@/lib/tamanhos";

type Variation = { size: string; color: string | null; stock: number };

type Props = {
  productId: string;
  stock: number;
  sizes: string[];
  colors: string[];
  variations?: Variation[];
};

export function AddToCart({ productId, stock, sizes, colors, variations = [] }: Props) {
  const [size, setSize] = useState<string>("");
  const [color, setColor] = useState<string>("");
  const [qty, setQty] = useState(1);
  const [loading, setLoading] = useState(false);
  const [added, setAdded] = useState(false);
  const [error, setError] = useState("");
  const [missing, setMissing] = useState<"size" | "color" | null>(null);
  const { addItem } = useCart();
  const router = useRouter();
  const sizeRef = useRef<HTMLDivElement>(null);
  const colorRef = useRef<HTMLDivElement>(null);

  const hasVar = variations.length > 0;
  const sizeList = ordenarTamanhos(
    sizes.length > 0 ? sizes : [...new Set(variations.map((v) => v.size))]
  );
  const colorList =
    colors.length > 0
      ? colors
      : [...new Set(variations.map((v) => v.color).filter((c): c is string => !!c))];

  // estoque disponível para a combinação atualmente selecionada
  function availFor(s?: string, c?: string): number {
    if (!hasVar) return stock;
    return variations
      .filter((v) => (!s || v.size === s) && (!c || (v.color ?? null) === c))
      .reduce((sum, v) => sum + v.stock, 0);
  }

  // Seleção padrão: primeira cor com estoque + tamanho único disponível.
  // Tamanho com múltiplas opções exige escolha consciente (reduz trocas).
  useEffect(() => {
    if (colorList.length > 0 && !color) {
      const first = colorList.find((c) => availFor(undefined, c) > 0) || "";
      if (first) setColor(first);
    }
    if (sizeList.length > 0 && !size) {
      const available = sizeList.filter((s) => availFor(s, color || undefined) > 0);
      if (available.length === 1) setSize(available[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId]);

  const comboStock = availFor(size || undefined, color || undefined);
  const needsSize = sizeList.length > 0 && !size;
  const needsColor = colorList.length > 0 && !color;
  const maxQty = hasVar ? comboStock : stock;
  const soldOut = maxQty <= 0;

  function flagMissing(which: "size" | "color", message: string): boolean {
    setMissing(which);
    setError(message);
    const ref = which === "size" ? sizeRef : colorRef;
    requestAnimationFrame(() => {
      ref.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    return false;
  }

  function validate(): boolean {
    setMissing(null);
    if (needsSize) return flagMissing("size", "Escolha um tamanho para continuar.");
    if (needsColor) return flagMissing("color", "Escolha uma cor para continuar.");
    if (soldOut) {
      setError("Produto esgotado nesta combinação.");
      return false;
    }
    setError("");
    return true;
  }

  async function add() {
    if (!validate()) return;
    setLoading(true);
    const ok = await addItem(productId, qty, size || undefined, color || undefined);
    setLoading(false);
    if (ok) {
      setAdded(true);
      setTimeout(() => setAdded(false), 2000);
    } else {
      setError("Não foi possível adicionar (estoque da combinação esgotado).");
    }
  }

  async function buyNow() {
    if (!validate()) return;
    setLoading(true);
    const ok = await addItem(productId, qty, size || undefined, color || undefined);
    setLoading(false);
    if (ok) router.push("/checkout");
    else setError("Não foi possível adicionar (estoque da combinação esgotado).");
  }

  function pickSize(s: string) {
    setSize(s);
    setQty(1);
    if (missing === "size") {
      setMissing(null);
      setError("");
    }
  }

  function pickColor(c: string) {
    setColor(c);
    setQty(1);
    if (missing === "color") {
      setMissing(null);
      setError("");
    }
  }

  return (
    <div className="mt-8 space-y-4">
      {sizeList.length > 0 && (
        <div ref={sizeRef} className={`scroll-mt-24 rounded-xl ${missing === "size" ? "ring-2 ring-red-500 ring-offset-2" : ""}`}>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-mute">
            Tamanho {size && <span className="text-ink">({size})</span>}
          </p>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Tamanhos">
            {sizeList.map((s) => {
              const out = availFor(s, color || undefined) <= 0;
              return (
                <button
                  key={s}
                  onClick={() => !out && pickSize(s)}
                  disabled={out}
                  aria-disabled={out}
                  aria-pressed={size === s}
                  title={out ? "Sem estoque nesta combinação" : undefined}
                  className={`min-w-11 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                    size === s
                      ? "border-ink bg-ink text-primary-50"
                      : out
                        ? "cursor-not-allowed border-ink/10 bg-ink/5 text-ink-mute/50 line-through"
                        : "border-ink/15 bg-white text-ink hover:border-ink/40"
                  }`}
                >
                  {s}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {colorList.length > 0 && (
        <div ref={colorRef} className={`scroll-mt-24 rounded-xl ${missing === "color" ? "ring-2 ring-red-500 ring-offset-2" : ""}`}>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-mute">
            Cor {color && <span className="text-ink">({color})</span>}
          </p>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Cores">
            {colorList.map((c) => {
              const out = availFor(size || undefined, c) <= 0;
              return (
                <button
                  key={c}
                  onClick={() => !out && pickColor(c)}
                  disabled={out}
                  aria-disabled={out}
                  aria-pressed={color === c}
                  title={out ? "Sem estoque nesta combinação" : undefined}
                  className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                    color === c
                      ? "border-ink bg-ink text-primary-50"
                      : out
                        ? "cursor-not-allowed border-ink/10 bg-ink/5 text-ink-mute/50 line-through"
                        : "border-ink/15 bg-white text-ink hover:border-ink/40"
                  }`}
                >
                  {c}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-mute">Quantidade</p>
        <div className="inline-flex items-center rounded-full border border-ink/15 bg-white">
          <button
            className="px-4 py-2 text-lg text-ink-soft hover:text-ink"
            onClick={() => setQty((q) => Math.max(1, q - 1))}
            disabled={qty <= 1}
            aria-label="Diminuir quantidade"
          >
            −
          </button>
          <span className="w-8 text-center text-sm font-semibold">{qty}</span>
          <button
            className="px-4 py-2 text-lg text-ink-soft hover:text-ink"
            onClick={() => setQty((q) => Math.min(Math.max(maxQty, 1), q + 1))}
            disabled={qty >= maxQty}
            aria-label="Aumentar quantidade"
          >
            +
          </button>
        </div>
        {hasVar && (
          <p className="mt-1 text-xs text-ink-mute">
            {soldOut
              ? "Esgotado nesta combinação."
              : size || color
                ? `${comboStock} unidade(s) disponível(is) nesta combinação`
                : "Selecione as opções para ver o estoque"}
          </p>
        )}
      </div>

      {soldOut && (
        <p className="rounded-lg bg-ink/5 p-3 text-sm text-ink-soft">
          Produto esgotado no momento. Em breve: avise-me quando chegar.
        </p>
      )}

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}

      <div className="flex flex-wrap gap-3 pt-2">
        <Button onClick={add} disabled={soldOut || loading} size="lg" className="flex-1 min-w-[180px]">
          {added ? "✓ Adicionado!" : loading ? "Adicionando..." : "Adicionar ao carrinho"}
        </Button>
        <Button
          variant="secondary"
          onClick={buyNow}
          disabled={soldOut || loading}
          size="lg"
          className="flex-1 min-w-[180px]"
        >
          Comprar agora
        </Button>
      </div>
    </div>
  );
}
