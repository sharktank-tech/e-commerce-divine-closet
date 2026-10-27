import Link from "next/link";
import { Button } from "@/components/ui/Button";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Pedido recebido" };

export default async function SucessoPage({
  searchParams,
}: {
  searchParams: Promise<{ pedido?: string; total?: string }>;
}) {
  const { pedido } = await searchParams;

  return (
    <div className="mx-auto max-w-xl px-4 py-20 text-center">
      <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-emerald-100 text-4xl">
        ✓
      </div>
      <h1 className="mt-6 font-display text-3xl font-bold text-ink">
        Pedido recebido
      </h1>
      <p className="mt-3 text-ink-mute">
        Acompanhe a situação do pagamento e do pedido pelos canais de acompanhamento.
      </p>
      {pedido && (
        <p className="mt-6 inline-block rounded-lg bg-white px-5 py-3 text-sm font-semibold text-ink shadow-sm">
          Nº do pedido: <span className="text-primary-700">{pedido}</span>
        </p>
      )}
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Button href="/conta?tab=pedidos" size="lg">
          Acompanhar pedido
        </Button>
        <Button href="/produtos" variant="outline" size="lg">
          Continuar comprando
        </Button>
      </div>
    </div>
  );
}
