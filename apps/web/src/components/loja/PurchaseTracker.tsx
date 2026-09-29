"use client";

import { useEffect } from "react";
import { analytics } from "@/lib/analytics";

// Dispara o evento purchase uma única vez por pedido (deduplicado por
// sessionStorage dentro de analytics.purchase).
export function PurchaseTracker({ pedido, total }: { pedido?: string; total?: string }) {
  useEffect(() => {
    if (!pedido) return;
    analytics.purchase(pedido, Number(total) || 0, []);
  }, [pedido, total]);

  return null;
}
