"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { useRouter } from "next/navigation";

type CartCtx = {
  count: number;
  refresh: () => Promise<void>;
  addItem: (productId: string, quantity?: number, size?: string, color?: string) => Promise<boolean>;
};

const Ctx = createContext<CartCtx>({
  count: 0,
  refresh: async () => {},
  addItem: async () => false,
});

export function CartProvider({ children }: { children: ReactNode }) {
  const [count, setCount] = useState(0);
  const router = useRouter();

  const refresh = async () => {
    try {
      const res = await fetch("/api/carrinho");
      if (res.ok) {
        const data = await res.json();
        setCount(data.count || 0);
      }
    } catch {
      // silencioso
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const addItem = async (
    productId: string,
    quantity = 1,
    size?: string,
    color?: string
  ) => {
    try {
      const res = await fetch("/api/carrinho", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId, quantity, size, color }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error || "Erro ao adicionar ao carrinho");
        return false;
      }
      await refresh();
      router.refresh();
      return true;
    } catch {
      return false;
    }
  };

  return <Ctx.Provider value={{ count, refresh, addItem }}>{children}</Ctx.Provider>;
}

export function useCart() {
  return useContext(Ctx);
}
