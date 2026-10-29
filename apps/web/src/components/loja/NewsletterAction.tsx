"use client";
import { useState } from "react";
export function NewsletterAction({
  action,
}: {
  action: "confirm" | "unsubscribe";
}) {
  const [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <>
      <h1 className="text-2xl font-semibold">
        {action === "confirm" ? "Confirmar inscrição" : "Cancelar inscrição"}
      </h1>
      <p className="my-4">
        {action === "confirm"
          ? "Confirme para receber novidades e ofertas da Divine Closet."
          : "Você deixará de receber e-mails promocionais. Mensagens sobre seus pedidos continuam disponíveis."}
      </p>
      <button
        className="rounded bg-primary-700 text-white p-3"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            const token = new URLSearchParams(location.search).get("token");
            const r = await fetch(`/api/newsletter/${action}`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ token }),
            });
            const b = await r.json();
            setMessage(b.message || b.error);
          } catch {
            setMessage("Não foi possível concluir. Tente novamente.");
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy
          ? "Aguarde…"
          : action === "confirm"
            ? "Confirmar inscrição"
            : "Confirmar cancelamento"}
      </button>
      <p role="status" className="mt-4">
        {message}
      </p>
    </>
  );
}
