"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

// Botão flutuante de WhatsApp — número vem do painel
// (/admin/configuracoes → empresa.whatsapp). Sem número, não renderiza.
export function WhatsAppButton() {
  const pathname = usePathname();
  const [whatsapp, setWhatsapp] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/config-loja")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const numero = String(d?.empresa?.whatsapp || "").replace(/\D/g, "");
        if (numero) setWhatsapp(numero);
      })
      .catch(() => {});
  }, []);

  if (pathname.startsWith("/admin") || !whatsapp) return null;

  return (
    <a
      href={`https://wa.me/55${whatsapp}?text=${encodeURIComponent("Olá! Vim pelo site da Divine Closet.")}`}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Conversar no WhatsApp"
      title="Conversar no WhatsApp"
      className="fixed bottom-5 right-5 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-[#25D366] text-white shadow-lg transition-transform hover:scale-105"
    >
      <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5.1-1.3A10 10 0 1 0 12 2zm0 18.2c-1.5 0-3-.4-4.3-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.6-6.1c-.3-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4 0-.5.1-.7l.4-.5c.1-.2.1-.4 0-.5l-.8-1.9c-.2-.5-.4-.4-.6-.4h-.5c-.2 0-.5.2-.7.7-.2.5-.9 2.1-.9 4.3 0 1.4.5 2.7 1.4 3.8l1.9 2.4c1.2.9 2.6 1.4 4 1.2 1.6-.2 2.6-1.2 2.8-2.2.1-.5.1-1 0-1.4 0-.1-.2-.2-.4-.3z" />
      </svg>
    </a>
  );
}
