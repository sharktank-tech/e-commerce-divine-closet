"use client";
import { useEffect } from "react";
import { analytics } from "@/lib/analytics";
export function ProductViewTracker({
  id,
  name,
  price,
}: {
  id: string;
  name: string;
  price: number;
}) {
  useEffect(() => {
    let emitted = false;
    const send = () => {
      if (!emitted)
        emitted = analytics.viewItem({ id, name, price, quantity: 1 });
    };
    send();
    window.addEventListener("dc-tracking-ready", send);
    return () => window.removeEventListener("dc-tracking-ready", send);
  }, [id, name, price]);
  return null;
}
