"use client";
import { useEffect, useState } from "react";
type Campaign = {
  id: string;
  subject: string;
  body: string;
  source: string | null;
  status: string;
  counts: Record<string, number>;
};
export default function Campaigns() {
  const [data, setData] = useState<{
      campaigns: Campaign[];
      eligible: { source: string | null; count: number }[];
      driver: string;
    } | null>(null),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [selected, setSelected] = useState<Campaign | null>(null);
  const [subject, setSubject] = useState(""),
    [body, setBody] = useState(""),
    [source, setSource] = useState("");
  async function refresh() {
    const r = await fetch("/api/admin/marketing/campanhas");
    if (r.ok) setData(await r.json());
    else setMessage("Acesso indisponível.");
  }
  useEffect(() => {
    void refresh();
  }, []);
  async function act(payload: object) {
    setBusy(true);
    try {
      const r = await fetch("/api/admin/marketing/campanhas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const d = await r.json();
      setMessage(
        d.error ||
          (d.simulated &&
            "Simulação: nenhum envio realizado; fila preservada.") ||
          "Operação concluída.",
      );
      await refresh();
      return r.ok;
    } catch {
      setMessage("Falha de comunicação.");
      return false;
    } finally {
      setBusy(false);
    }
  }
  const count =
    data?.eligible
      .filter((e) => !source || e.source === source)
      .reduce((n, e) => n + e.count, 0) || 0;
  return (
    <div className="max-w-4xl space-y-6">
      <h1 className="text-2xl font-bold">Campanhas de e-mail</h1>
      <p>
        Transporte: {data?.driver || "carregando"}. Aceitação pelo provedor não
        comprova entrega.
      </p>
      <p role="status">{message}</p>
      <form
        className="space-y-3 rounded bg-white p-5"
        onSubmit={async (e) => {
          e.preventDefault();
          if (
            await act({
              action: selected ? "edit" : "create",
              ...(selected ? { id: selected.id } : {}),
              subject,
              body,
              source: source || null,
            })
          ) {
            setSelected(null);
            setSubject("");
            setBody("");
          }
        }}
      >
        <h2>{selected ? "Editar rascunho" : "Novo rascunho"}</h2>
        <label className="block">
          Assunto
          <input
            className="block border p-2 w-full"
            required
            maxLength={200}
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
          />
        </label>
        <label className="block">
          Conteúdo (texto simples)
          <textarea
            className="block border p-2 w-full"
            required
            maxLength={10000}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        </label>
        <label className="block">
          Público
          <select
            className="block border p-2"
            value={source}
            onChange={(e) => setSource(e.target.value)}
          >
            <option value="">Todos os confirmados</option>
            <option value="footer">Inscritos pelo rodapé</option>
            <option value="newsletter">Inscritos pela newsletter</option>
          </select>
        </label>
        <p>Elegíveis agora: {count}. Cancelados e pendentes não entram.</p>
        <h3>Prévia</h3>
        <p className="font-semibold">{subject}</p>
        <pre className="whitespace-pre-wrap font-sans">{body}</pre>
        <p>O link de descadastro será incluído automaticamente.</p>
        <button className="rounded border p-2" disabled={busy}>
          Salvar rascunho
        </button>
      </form>
      <a className="underline" href="/admin/configuracoes">
        Enviar teste individual nas configurações
      </a>
      {data?.campaigns.map((c) => (
        <article key={c.id} className="rounded bg-white p-4 space-y-2">
          <h2 className="font-semibold">{c.subject}</h2>
          <p>
            {c.status} · {JSON.stringify(c.counts)}
          </p>
          <pre className="whitespace-pre-wrap font-sans">{c.body}</pre>
          {c.status === "DRAFT" && (
            <>
              <button
                className="border p-2 mr-2"
                disabled={busy}
                onClick={() => {
                  setSelected(c);
                  setSubject(c.subject);
                  setBody(c.body);
                  setSource(c.source || "");
                }}
              >
                Editar
              </button>
              <button
                className="border p-2"
                disabled={busy}
                onClick={() => {
                  const n = data.eligible
                    .filter((e) => !c.source || e.source === c.source)
                    .reduce((a, e) => a + e.count, 0);
                  if (
                    window.confirm(
                      `Enfileirar a campanha “${c.subject}” para ${n} destinatários? O processamento pode enviar e-mails reais.`,
                    )
                  )
                    void act({
                      action: "queue",
                      id: c.id,
                      confirm: true,
                      expectedRecipients: n,
                    });
                }}
              >
                Confirmar enfileiramento
              </button>
            </>
          )}
          {c.status !== "CANCELLED" && (
            <button
              className="border p-2 ml-2"
              disabled={busy}
              onClick={() => {
                if (confirm("Cancelar envios ainda não iniciados?"))
                  void act({ action: "cancel", id: c.id });
              }}
            >
              Cancelar pendentes
            </button>
          )}
        </article>
      ))}
      <button
        className="border p-3"
        disabled={busy}
        onClick={() => {
          if (
            confirm(
              "Processar até 10 mensagens, incluindo confirmações? Com transporte ativo isso envia e-mails reais.",
            )
          )
            void act({ action: "drain", confirm: true });
        }}
      >
        Processar lote de até 10 mensagens
      </button>
    </div>
  );
}
