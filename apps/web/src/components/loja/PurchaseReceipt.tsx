"use client";

import { useState } from "react";
import Link from "next/link";
import { PurchaseTracker } from "@/components/loja/PurchaseTracker";

type Status = "checking" | "paid" | "pending" | "unavailable";

export function PurchaseReceipt({ pedido }: { pedido?: string }) {
  const [status, setStatus] = useState<Status>("checking");

  if (!pedido || pedido.length > 64) {
    return (
      <div className="mx-auto max-w-xl px-4 py-20 text-center">
        <h1 className="font-display text-3xl font-bold text-ink">Pedido não identificado</h1>
        <p className="mt-3 text-ink-mute">Acesse seu pedido pela conta ou pelo link privado recebido por e-mail.</p>
        <Link href="/conta?tab=pedidos" className="mt-6 inline-block underline">Consultar pedidos</Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl px-4 py-20 text-center">
      <PurchaseTracker pedido={pedido} onResult={setStatus} />
      <h1 className="font-display text-3xl font-bold text-ink">
        {status === "paid" ? "Pagamento confirmado" : status === "pending" ? "Aguardando confirmação do pagamento" : status === "unavailable" ? "Não foi possível validar este pedido" : "Verificando pedido"}
      </h1>
      <p className="mt-3 text-ink-mute">
        {status === "paid"
          ? "Seu pagamento foi confirmado. Acompanhe o andamento do pedido na sua conta ou no link privado enviado por e-mail."
          : status === "pending"
            ? "Seu pedido ainda está sendo confirmado. Mantenha esta página aberta para acompanhar a atualização."
            : status === "unavailable"
              ? "A confirmação exige a sessão original da compra ou um link privado válido. Não é possível confirmar uma compra apenas pelo identificador na URL."
              : "Consultando o status do pedido com segurança."}
      </p>
      {status === "paid" && (
        <p className="mt-6 inline-block rounded-lg bg-white px-5 py-3 text-sm font-semibold text-ink shadow-sm">
          Identificação do pedido: <span className="text-primary-700">{pedido}</span>
        </p>
      )}
      <div className="mt-8 flex flex-wrap justify-center gap-5 text-sm font-semibold">
        <Link href="/conta?tab=pedidos" className="underline">Acompanhar pedido</Link>
        <Link href="/produtos" className="underline">Continuar comprando</Link>
      </div>
    </div>
  );
}
