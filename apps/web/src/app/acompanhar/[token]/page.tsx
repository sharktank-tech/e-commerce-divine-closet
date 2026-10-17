import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/Badge";
import { formatBRL, formatDate, orderStatusLabel } from "@/lib/utils";
import { buscarPedidoPorToken } from "@/lib/pedidos/acompanhar";
import {
  linkRastreio,
  mensagemSemRastreio,
  rotuloTransportadora,
} from "@/lib/rastreio";

// Acompanhamento de pedido de CONVIDADO por link privado. Sem login, sem
// dados pessoais (nada de nome, e-mail, telefone ou endereço) — o token é
// o segredo. Token inválido/expirado → 404 genérico (sem vazar existência).
export const dynamic = "force-dynamic";

export async function generateMetadata() {
  return {
    title: "Acompanhar pedido",
    robots: { index: false, follow: false },
  };
}

export default async function AcompanharPedidoPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const pedido = await buscarPedidoPorToken(token);
  if (!pedido) notFound();

  const link = linkRastreio(pedido);

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-mute">
        Acompanhamento de pedido
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold text-ink">Pedido {pedido.number}</h1>
        <Badge status={pedido.status}>{orderStatusLabel(pedido.status)}</Badge>
      </div>
      <p className="mt-1 text-sm text-ink-mute">
        Realizado em {formatDate(pedido.createdAt)} · Total {formatBRL(Number(pedido.total))}
      </p>

      <section className="mt-6 rounded-xl border border-ink/10 bg-white p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-mute">
          Rastreamento
        </h2>
        {pedido.trackingCode ? (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
            {rotuloTransportadora(pedido.trackingCarrier) && (
              <span className="text-ink-mute">{rotuloTransportadora(pedido.trackingCarrier)}</span>
            )}
            <span className="rounded bg-ink/5 px-2 py-0.5 font-mono text-ink">
              {pedido.trackingCode}
            </span>
            {link && (
              <a
                href={link}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs font-semibold text-primary-700 underline-offset-2 hover:underline"
              >
                Acompanhar entrega ↗
              </a>
            )}
          </div>
        ) : (
          <p className="mt-2 text-sm text-ink-mute">{mensagemSemRastreio(pedido.status)}</p>
        )}
      </section>

      <section className="mt-4 rounded-xl border border-ink/10 bg-white p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-mute">Itens</h2>
        <ul className="mt-2 space-y-1 text-sm text-ink-soft">
          {pedido.items.map((i, k) => (
            <li key={k}>
              {i.quantity}× {i.productName}
              {i.size && ` — Tam ${i.size}`}
            </li>
          ))}
        </ul>
      </section>

      <p className="mt-6 text-xs text-ink-mute">
        Este link é privado e expira em 30 dias. Peça um novo em{" "}
        <a href="/acompanhar" className="underline">
          Acompanhar pedido
        </a>{" "}
        se ele parar de funcionar.
      </p>
    </main>
  );
}
