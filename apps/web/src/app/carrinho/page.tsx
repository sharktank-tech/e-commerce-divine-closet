"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { formatBRL } from "@/lib/utils";
import { shipping as shippingConfig } from "@/config/defaults";

type Item = {
  id: string;
  quantity: number;
  size: string | null;
  color: string | null;
  lineTotal: number;
  product: {
    id: string;
    name: string;
    slug: string;
    price: string | number;
    stock: number;
    images: string[];
    category: string;
  };
};

export default function CarrinhoPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [subtotal, setSubtotal] = useState(0);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/carrinho");
      if (res.ok) {
        const data = await res.json();
        setItems(data.items);
        setSubtotal(data.subtotal);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function updateQty(itemId: string, quantity: number) {
    await fetch("/api/carrinho", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemId, quantity }),
    });
    load();
  }

  async function remove(itemId: string) {
    await fetch(`/api/carrinho?itemId=${itemId}`, { method: "DELETE" });
    load();
  }

  const shipping =
    subtotal >= shippingConfig.freeFrom || subtotal === 0
      ? 0
      : shippingConfig.fixed;
  const total = subtotal + shipping;

  if (loading) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-16 text-center text-ink-mute">
        Carregando carrinho...
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-20 text-center">
        <p className="font-display text-3xl font-bold text-ink">Seu carrinho está vazio</p>
        <p className="mt-3 text-ink-mute">Que tal explorar a coleção?</p>
        <Button href="/produtos" className="mt-6" size="lg">
          Ver produtos
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <h1 className="font-display text-3xl font-bold text-ink">Carrinho</h1>
      <p className="mt-1 text-sm text-ink-mute">{items.length} item(ns)</p>

      <div className="mt-8 grid gap-8 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {items.map((item) => (
            <div
              key={item.id}
              className="flex gap-4 rounded-xl border border-ink/10 bg-white p-4"
            >
              <Link
                href={`/produtos/${item.product.slug}`}
                className="h-24 w-20 shrink-0 overflow-hidden rounded-lg bg-divine-100"
              >
                {item.product.images[0] ? (
                  <img
                    src={item.product.images[0]}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-divine-400 text-xs">DC</div>
                )}
              </Link>

              <div className="flex flex-1 flex-col">
                <div className="flex justify-between gap-3">
                  <div>
                    <Link
                      href={`/produtos/${item.product.slug}`}
                      className="font-medium text-ink hover:underline"
                    >
                      {item.product.name}
                    </Link>
                    <p className="mt-0.5 text-xs text-ink-mute">
                      {item.product.category}
                      {item.size && ` • Tam ${item.size}`}
                      {item.color && ` • ${item.color}`}
                    </p>
                  </div>
                  <p className="font-semibold text-ink">{formatBRL(item.lineTotal)}</p>
                </div>

                <div className="mt-auto flex items-center justify-between pt-3">
                  <div className="inline-flex items-center rounded-full border border-ink/15">
                    <button
                      className="px-3 py-1 text-ink-soft"
                      onClick={() => updateQty(item.id, item.quantity - 1)}
                    >
                      −
                    </button>
                    <span className="w-7 text-center text-sm">{item.quantity}</span>
                    <button
                      className="px-3 py-1 text-ink-soft"
                      onClick={() => updateQty(item.id, item.quantity + 1)}
                      disabled={item.quantity >= item.product.stock}
                    >
                      +
                    </button>
                  </div>
                  <button
                    onClick={() => remove(item.id)}
                    className="text-xs text-red-600 hover:underline"
                  >
                    Remover
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>

        <aside className="h-fit rounded-xl border border-ink/10 bg-white p-6">
          <h2 className="font-display text-xl font-bold text-ink">Resumo</h2>
          <dl className="mt-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-ink-mute">Subtotal</dt>
              <dd className="font-medium">{formatBRL(subtotal)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink-mute">Frete</dt>
              <dd className="font-medium">
                {shipping === 0 ? "Grátis" : formatBRL(shipping)}
              </dd>
            </div>
            <div className="mt-3 flex justify-between border-t border-ink/10 pt-3 text-base font-bold">
              <dt>Total</dt>
              <dd>{formatBRL(total)}</dd>
            </div>
          </dl>

          {subtotal < shippingConfig.freeFrom && subtotal > 0 && (
            <p className="mt-3 rounded-lg bg-primary-50 p-3 text-xs text-primary-800">
              Faltam {formatBRL(shippingConfig.freeFrom - subtotal)} para frete
              grátis.
            </p>
          )}

          <Button href="/checkout" className="mt-5 w-full" size="lg">
            Finalizar compra
          </Button>
          <Button href="/produtos" variant="ghost" className="mt-2 w-full">
            Continuar comprando
          </Button>
        </aside>
      </div>
    </div>
  );
}
