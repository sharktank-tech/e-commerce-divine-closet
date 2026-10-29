"use client";

import { useEffect, useState } from "react";
import { formatBRL } from "@/lib/utils";

type Indicadores = {
  pedidosPagos: number;
  receitaBruta: number;
  valoresEstornados: number;
  receitaAposEstornos: number;
  ticketMedio: number;
  vendasPorOrigem: Array<{ origem: string; pedidos: number; receita: number }>;
  assinantes: { confirmados: number; cancelados: number; pendentes: number };
  campanhas: {
    rascunho: number;
    enfileiradas: number;
    processadas: number;
    falhas: number;
  };
};

export default function AdminMarketingPage() {
  const [dados, setDados] = useState<Indicadores | null>(null);
  const [loading, setLoading] = useState(true);
  const [periodo, setPeriodo] = useState({ inicio: "", fim: "", excluir: "" });
  const [query, setQuery] = useState("");
  const [erro, setErro] = useState("");

  useEffect(() => {
    fetch(`/api/admin/marketing/indicadores?${query}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setErro(d.error);
        else setDados(d);
      })
      .catch(() => setErro("Erro ao carregar indicadores"))
      .finally(() => setLoading(false));
  }, [query]);

  if (loading)
    return <p className="text-ink-mute">Carregando indicadores...</p>;
  if (erro) return <p className="text-red-600">{erro}</p>;
  if (!dados) return <p className="text-ink-mute">Sem dados.</p>;

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 space-y-6">
      <h1 className="text-3xl font-bold text-gray-800">
        Indicadores de Marketing e Vendas
      </h1>

      <a className="underline" href="/admin/marketing/campanhas">
        Gerenciar campanhas
      </a>
      <form
        className="flex flex-wrap gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          setQuery(new URLSearchParams(periodo).toString());
        }}
      >
        <label>
          Início
          <input
            type="date"
            className="block border p-2"
            value={periodo.inicio}
            onChange={(e) => setPeriodo({ ...periodo, inicio: e.target.value })}
          />
        </label>
        <label>
          Fim
          <input
            type="date"
            className="block border p-2"
            value={periodo.fim}
            onChange={(e) => setPeriodo({ ...periodo, fim: e.target.value })}
          />
        </label>
        <label>
          Excluir pedidos de teste (números separados por vírgula)
          <input
            className="block border p-2"
            value={periodo.excluir}
            onChange={(e) =>
              setPeriodo({ ...periodo, excluir: e.target.value })
            }
          />
        </label>
        <button className="border p-2">Filtrar</button>
      </form>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card label="Pedidos pagos" value={dados.pedidosPagos} />
        <Card label="Receita bruta" value={formatBRL(dados.receitaBruta)} />
        <Card
          label="Valores estornados"
          value={formatBRL(dados.valoresEstornados)}
        />
        <Card
          label="Receita após estornos"
          value={formatBRL(dados.receitaAposEstornos)}
        />
        <Card label="Ticket médio" value={formatBRL(dados.ticketMedio)} />
        <Card
          label="Assinantes confirmados"
          value={dados.assinantes.confirmados}
        />
        <Card
          label="Assinantes cancelados"
          value={dados.assinantes.cancelados}
        />
        <Card label="Assinantes pendentes" value={dados.assinantes.pendentes} />
      </div>

      <div className="bg-white rounded-2xl shadow p-6">
        <h2 className="text-xl font-semibold mb-4">Vendas por Origem (UTM)</h2>
        {dados.vendasPorOrigem.length === 0 ? (
          <p className="text-gray-500">Sem dados de origem.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="text-left py-2">Origem</th>
                <th className="text-right py-2">Pedidos</th>
                <th className="text-right py-2">Receita</th>
              </tr>
            </thead>
            <tbody>
              {dados.vendasPorOrigem.map((o) => (
                <tr key={o.origem} className="border-b">
                  <td className="py-2">{o.origem}</td>
                  <td className="text-right py-2">{o.pedidos}</td>
                  <td className="text-right py-2">{formatBRL(o.receita)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="bg-white rounded-2xl shadow p-6">
        <h2 className="text-xl font-semibold mb-4">Campanhas</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card label="Rascunho" value={dados.campanhas.rascunho} />
          <Card label="Enfileiradas" value={dados.campanhas.enfileiradas} />
          <Card
            label="Mensagens aceitas pelo provedor"
            value={dados.campanhas.processadas}
          />
          <Card label="Falhas" value={dados.campanhas.falhas} />
        </div>
      </div>

      <p className="text-xs text-gray-500">
        Nota: receita após estornos não é lucro. Somente estornos APPROVED são
        subtraídos. O modelo atual suporta um estorno por pedido. Pedidos de
        teste não são excluídos automaticamente. Fuso horário:
        America/Sao_Paulo. Período baseado na criação do pedido; estornos
        aprovados da mesma coorte, inclusive posteriores. Assinantes e campanhas
        são totais atuais. Dados sem UTM aparecem como &quot;origem
        desconhecida&quot;.
      </p>
    </div>
  );
}

function Card({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-white rounded-2xl shadow p-4">
      <p className="text-sm text-gray-500">{label}</p>
      <p className="text-xl font-bold text-gray-800">{value}</p>
    </div>
  );
}
