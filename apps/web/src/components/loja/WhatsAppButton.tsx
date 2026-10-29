"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { WhatsAppIcon } from "@/components/ui/SocialIcons";

// Botão flutuante de WhatsApp — número vem do painel
// (/admin/configuracoes → empresa.whatsapp). Sem número, não renderiza.
export function WhatsAppButton() {
  const pathname = usePathname();
  const [contato, setContato] = useState<{ whatsapp: string; mensagem: string } | null>(null);

  useEffect(() => {
    fetch("/api/config-loja")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const numero = String(d?.empresa?.whatsapp || "").replace(/\D/g, "");
        if (numero) {
          setContato({
            whatsapp: numero,
            mensagem:
              String(d?.empresa?.whatsappMensagem || "") ||
              "Olá! Vim pelo site da Divine Closet.",
          });
        }
      })
      .catch(() => {});
  }, []);

  if (pathname.startsWith("/admin") || !contato) return null;

  return (
    <a
      href={`https://wa.me/55${contato.whatsapp}?text=${encodeURIComponent(contato.mensagem)}`}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Conversar no WhatsApp"
      title="Conversar no WhatsApp"
      className="fixed bottom-5 right-5 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-[#25D366] text-white shadow-lg transition-transform hover:scale-105"
    >
      <WhatsAppIcon className="h-7 w-7" />
    </a>
  );
}
