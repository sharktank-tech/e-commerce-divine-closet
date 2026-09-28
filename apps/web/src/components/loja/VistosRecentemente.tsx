"use client";

import { useEffect, useState } from "react";
import { ProductCard } from "./ProductCard";
import { pushRecent } from "@/lib/recomendacoes";

const KEY = "dc-recent-ids";

// Registra a visita e exibe outros vistos recentemente (2+ itens).
export function VistosRecentemente({ currentId }: { currentId: string }) {
  const [items, setItems] = useState<Array<React.ComponentProps<typeof ProductCard>["product"]>>([]);

  useEffect(() => {
    let list: string[] = [];
    try {
      list = JSON.parse(localStorage.getItem(KEY) || "[]");
      if (!Array.isArray(list)) list = [];
    } catch {
      list = [];
    }
    const next = pushRecent(list.filter((x) => typeof x === "string"), currentId);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      // storage indisponível: segue sem recentes
    }
    const others = next.filter((id) => id !== currentId).slice(0, 8);
    if (others.length < 2) return;
    fetch(`/api/produtos?ids=${others.join(",")}&pageSize=8`)
      .then((r) => r.json())
      .then((d) => setItems(d.items || []))
      .catch(() => {});
  }, [currentId]);

  if (items.length < 2) return null;

  return (
    <section className="mt-16 border-t border-ink/10 pt-10">
      <h2 className="font-display text-2xl font-bold text-ink">Vistos recentemente</h2>
      <div className="mt-6 flex snap-x snap-mandatory gap-4 overflow-x-auto pb-2 md:grid md:grid-cols-4 md:overflow-visible md:pb-0">
        {items.slice(0, 4).map((p) => (
          <div key={p.id} className="w-[68%] shrink-0 snap-start sm:w-[44%] md:w-auto">
            <ProductCard product={p} />
          </div>
        ))}
      </div>
    </section>
  );
}
