"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { formatDate } from "@/lib/utils";

type StatusFila = "PENDING" | "DELIVERED" | "FAILED" | "DEAD";

type Resposta = {
  configurado: boolean;
  contagens: Record<StatusFila, number>;
  ultimas: Array<{
    id: string;
    tipo: string;
    status: StatusFila;
    attempt: number;
    lastStatusCode: number | null;
    lastError: string | null;
    nextAttemptAt: string;
    createdAt: string;
  }>;
};

const rotulos: Record<StatusFila, string> = {
  PENDING: "Pendentes",
  DELIVERED: "Entregues",
  FAILED: "Com falha",
  DEAD: "Esgotados",
};

export default function AdminErpPage() {
  const [dados, setDados] = useState<Resposta | null>(null);
  const [erro, setErro] = useState("");
  const [reprocessando, setReprocessando] = useState(false);

  const carregar = useCallback(async () => {
    const res = await fetch("/api/admin/erp");
    if (!res.ok) {
      setErro("Erro ao carregar fila");
      return;
    }
    setDados(await res.json());
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  async function reprocessar() {
    setReprocessando(true);
    try {
      const res = await fetch("/api/admin/erp?acao=reprocessar", { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        entregues?: number;
      };
      if (!res.ok) alert(body.error || "Erro ao reprocessar");
      else alert(`Dreno concluído: ${body.entregues ?? 0} entregue(s).`);
      await carregar();
    } finally {
      setReprocessando(false);
    }
  }

  if (erro)
    return (
      <div className="rounded-xl border border-amber-300 bg-amber-50 p-6 text-sm text-amber-900">
        {erro}
      </div>
    );
  if (!dados) return <p className="text-ink-mute">Carregando fila...</p>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink">Integração ERP</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Fila persistente de eventos loja → ERP. Tentativa imediata + retries
          com backoff; o dreno automático roda no cron diário.
        </p>
      </div>

      {!dados.configurado && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          ERP não configurado — defina <span className="font-mono">ERP_WEBHOOK_URL</span> e{" "}
          <span className="font-mono">ERP_WEBHOOK_SECRET</span> na Vercel e faça
          redeploy. Enquanto isso, nenhum evento é persistido ou enviado.
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {(Object.keys(rotulos) as StatusFila[]).map((k) => (
          <div key={k} className="rounded-xl border border-ink/10 bg-white p-4">
            <p className="text-xs uppercase tracking-wide text-ink-mute">{rotulos[k]}</p>
            <p className="mt-1 text-2xl font-semibold text-ink">{dados.contagens[k] ?? 0}</p>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={reprocessando || !dados.configurado}
          onClick={reprocessar}
        >
          {reprocessando ? "Processando..." : "Reprocessar agora"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={carregar}>
          Atualizar
        </Button>
      </div>

      <section className="rounded-xl border border-ink/10 bg-white p-5">
        <h2 className="font-semibold text-ink">Últimos eventos</h2>
        <p className="mt-1 text-xs text-ink-mute">
          Sem conteúdo dos eventos — apenas tipo, estado e tentativas.
        </p>
        {dados.ultimas.length === 0 ? (
          <p className="mt-3 text-sm text-ink-mute">Nenhum evento registrado.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-ink/10 text-xs uppercase tracking-wide text-ink-mute">
                  <th className="py-2 pr-3">Tipo</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">Tent.</th>
                  <th className="py-2 pr-3">HTTP</th>
                  <th className="py-2 pr-3">Criado</th>
                </tr>
              </thead>
              <tbody>
                {dados.ultimas.map((ev) => (
                  <tr key={ev.id} className="border-b border-ink/5">
                    <td className="py-2 pr-3 font-medium text-ink">{ev.tipo}</td>
                    <td className="py-2 pr-3">
                      <Badge
                        status={
                          ev.status === "DELIVERED"
                            ? "DELIVERED"
                            : ev.status === "DEAD"
                              ? "CANCELLED"
                              : ev.status === "FAILED"
                                ? "FAILED"
                                : "PENDING"
                        }
                      >
                        {rotulos[ev.status]}
                      </Badge>
                    </td>
                    <td className="py-2 pr-3">{ev.attempt}</td>
                    <td className="py-2 pr-3">{ev.lastStatusCode ?? "—"}</td>
                    <td className="py-2 pr-3 text-ink-mute">{formatDate(ev.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
