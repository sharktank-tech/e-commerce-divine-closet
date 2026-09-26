"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useCart } from "./CartProvider";
import { Button } from "@/components/ui/Button";

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
  const { addItem } = useCart();
  const router = useRouter();

  const hasVar = variations.length > 0;
  const sizeList = sizes.length > 0 ? sizes : [...new Set(variations.map((v) => v.size))];
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

  const comboStock = availFor(size || undefined, color || undefined);
  const needsSize = sizeList.length > 0 && !size;
  const needsColor = colorList.length > 0 && !color;
  const maxQty = hasVar ? comboStock : stock;
  const disabled = maxQty <= 0 || needsSize || needsColor;

  async function add() {
    setLoading(true);
    setError("");
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
    setLoading(true);
    setError("");
    const ok = await addItem(productId, qty, size || undefined, color || undefined);
    setLoading(false);
    if (ok) router.push("/checkout");
    else setError("Não foi possível adicionar (estoque da combinação esgotado).");
  }

  return (
    <div className="mt-8 space-y-4">
      {sizeList.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-mute">
            Tamanho {size && <span className="text-ink">({size})</span>}
          </p>
          <div className="flex flex-wrap gap-2">
            {sizeList.map((s) => {
              const out = availFor(s, color || undefined) <= 0;
              return (
                <button
                  key={s}
                  onClick={() => setSize(s)}
                  disabled={out}
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
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-mute">
            Cor {color && <span className="text-ink">({color})</span>}
          </p>
          <div className="flex flex-wrap gap-2">
            {colorList.map((c) => {
              const out = availFor(size || undefined, c) <= 0;
              return (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  disabled={out}
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
          >
            −
          </button>
          <span className="w-8 text-center text-sm font-semibold">{qty}</span>
          <button
            className="px-4 py-2 text-lg text-ink-soft hover:text-ink"
            onClick={() => setQty((q) => Math.min(maxQty, q + 1))}
            disabled={qty >= maxQty}
          >
            +
          </button>
        </div>
        {hasVar && (
          <p className="mt-1 text-xs text-ink-mute">
            {size || color
              ? `${comboStock} unidade(s) disponível(is) nesta combinação`
              : "Selecione as opções para ver o estoque"}
          </p>
        )}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex flex-wrap gap-3 pt-2">
        <Button onClick={add} disabled={disabled || loading} size="lg" className="flex-1 min-w-[180px]">
          {added ? "✓ Adicionado!" : loading ? "Adicionando..." : "Adicionar ao carrinho"}
        </Button>
        <Button
          variant="secondary"
          onClick={buyNow}
          disabled={disabled || loading}
          size="lg"
          className="flex-1 min-w-[180px]"
        >
          Comprar agora
        </Button>
      </div>
    </div>
  );
}
