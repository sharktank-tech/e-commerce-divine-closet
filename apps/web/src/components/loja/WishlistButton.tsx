"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export function WishlistButton({ productId }: { productId: string }) {
  const router = useRouter();
  const [active, setActive] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/wishlist")
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d) => {
        if (Array.isArray(d.items)) {
          setActive(d.items.some((p: { id: string }) => p.id === productId));
        }
      })
      .catch(() => {});
  }, [productId]);

  async function toggle() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/wishlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId }),
      });
      if (res.status === 401) {
        router.push(`/login?next=${encodeURIComponent(window.location.pathname)}`);
        return;
      }
      const data = await res.json();
      if (res.ok) setActive(data.active);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={active}
      className={`flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition ${
        active
          ? "border-red-200 bg-red-50 text-red-600"
          : "border-ink/15 bg-white text-ink-soft hover:border-ink/30"
      }`}
    >
      <span aria-hidden>{active ? "♥" : "♡"}</span>
      {active ? "Na lista de desejos" : "Salvar na lista"}
    </button>
  );
}
