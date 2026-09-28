"use client";

import { useEffect, useState } from "react";
import type { ReviewSummary } from "@/lib/avaliacoes";

type Item = {
  id: string;
  rating: number;
  titulo?: string | null;
  texto: string;
  tamanhoComprado?: string | null;
  caimento?: string | null;
  alturaCliente?: string | null;
  respostaLoja?: string | null;
  autor: string;
  createdAt: string;
  fotos: string[];
};

type Props = {
  productId: string;
  productSlug: string;
  initialSummary: ReviewSummary;
};

function Stars({ value, size = 16 }: { value: number; size?: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${value} de 5 estrelas`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <svg
          key={i}
          width={size}
          height={size}
          viewBox="0 0 24 24"
          aria-hidden="true"
          className={i <= Math.round(value) ? "fill-amber-400" : "fill-ink/15"}
        >
          <path d="M12 2l2.9 6.6 7.1.7-5.4 4.8 1.6 7-6.2-3.7-6.2 3.7 1.6-7L2 9.3l7.1-.7z" />
        </svg>
      ))}
    </span>
  );
}

export function Avaliacoes({ productId, productSlug, initialSummary }: Props) {
  const [summary] = useState(initialSummary);
  const [items, setItems] = useState<Item[]>([]);
  const [total, setTotal] = useState(initialSummary.total);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [ordem, setOrdem] = useState("recentes");
  const [comFotos, setComFotos] = useState(false);
  const [logged, setLogged] = useState(false);
  const [elig, setElig] = useState<{ eligible: boolean; orderId?: string }>({
    eligible: false,
  });
  const [showForm, setShowForm] = useState(false);

  // form
  const [rating, setRating] = useState(5);
  const [titulo, setTitulo] = useState("");
  const [texto, setTexto] = useState("");
  const [tamanho, setTamanho] = useState("");
  const [caimento, setCaimento] = useState("");
  const [altura, setAltura] = useState("");
  const [fotos, setFotos] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);
  const [formMsg, setFormMsg] = useState("");
  const [formOk, setFormOk] = useState(false);

  async function loadList(p = 1, o = ordem, f = comFotos) {
    const res = await fetch(
      `/api/avaliacoes?produto=${productSlug}&page=${p}&ordem=${o}${f ? "&comFotos=1" : ""}`
    );
    if (!res.ok) return;
    const data = await res.json();
    setItems(data.items || []);
    setTotal(data.total || 0);
    setTotalPages(data.totalPages || 1);
    setPage(data.page || 1);
  }

  useEffect(() => {
    loadList(1, ordem, comFotos);
    fetch("/api/auth/me").then(async (r) => {
      if (!r.ok) return;
      setLogged(true);
      const e = await fetch(`/api/avaliacoes/elegibilidade?produtoId=${productId}`).then((x) =>
        x.json()
      );
      setElig(e);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId]);

  // esconde o bloco quando não há avaliações e ninguém elegível pode inaugurar
  if (summary.total === 0 && items.length === 0 && !elig.eligible) return null;

  async function handleFiles(files: FileList | null) {
    if (!files) return;
    const rest = 3 - fotos.length;
    if (rest <= 0) {
      setFormMsg("Máximo 3 fotos por avaliação.");
      return;
    }
    setUploading(true);
    setFormMsg("");
    try {
      for (const f of Array.from(files).slice(0, rest)) {
        const fd = new FormData();
        fd.append("file", f);
        const res = await fetch("/api/upload", { method: "POST", body: fd });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Falha no upload");
        setFotos((prev) => [...prev, data.url].slice(0, 3));
      }
    } catch (e) {
      setFormMsg(e instanceof Error ? e.message : "Erro no upload");
    } finally {
      setUploading(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!elig.orderId) return;
    setSending(true);
    setFormMsg("");
    try {
      const res = await fetch("/api/avaliacoes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId,
          orderId: elig.orderId,
          rating,
          titulo: titulo || null,
          texto,
          tamanhoComprado: tamanho || null,
          caimento: caimento || null,
          alturaCliente: altura || null,
          fotos,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFormMsg(data.error || "Erro ao enviar");
        return;
      }
      setFormOk(true);
      setElig({ eligible: false });
    } catch {
      setFormMsg("Erro de conexão");
    } finally {
      setSending(false);
    }
  }

  const fitTotal = summary.caimento.pequeno + summary.caimento.ideal + summary.caimento.grande;

  return (
    <section id="avaliacoes" className="mt-16 border-t border-ink/10 pt-10 scroll-mt-24">
      <h2 className="font-display text-2xl font-bold text-ink">Avaliações</h2>

      {summary.total > 0 ? (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Stars value={summary.media} size={20} />
            <span className="text-lg font-bold text-ink">{summary.media.toFixed(1)}</span>
            <span className="text-sm text-ink-mute">({summary.total} avaliações)</span>
          </div>

          <div className="mt-4 grid gap-6 sm:grid-cols-2">
            <div className="space-y-1.5">
              {([5, 4, 3, 2, 1] as const).map((n) => (
                <div key={n} className="flex items-center gap-2 text-xs">
                  <span className="w-8 text-ink-mute">{n} ★</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-ink/10">
                    <div
                      className="h-full rounded-full bg-amber-400"
                      style={{ width: `${summary.total ? Math.round((summary.dist[n] / summary.total) * 100) : 0}%` }}
                    />
                  </div>
                  <span className="w-6 text-right text-ink-mute">{summary.dist[n]}</span>
                </div>
              ))}
            </div>
            {fitTotal > 0 && (
              <div className="rounded-xl border border-ink/10 bg-white p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-mute">
                  Caimento ({fitTotal} respostas)
                </p>
                <div className="mt-2 flex h-2.5 overflow-hidden rounded-full">
                  <div className="bg-primary-300" style={{ width: `${(summary.caimento.pequeno / fitTotal) * 100}%` }} title="Pequeno" />
                  <div className="bg-primary-600" style={{ width: `${(summary.caimento.ideal / fitTotal) * 100}%` }} title="Ideal" />
                  <div className="bg-primary-800" style={{ width: `${(summary.caimento.grande / fitTotal) * 100}%` }} title="Grande" />
                </div>
                <div className="mt-1.5 flex justify-between text-[11px] text-ink-mute">
                  <span>Pequeno</span>
                  <span>Ideal</span>
                  <span>Grande</span>
                </div>
              </div>
            )}
          </div>
        </>
      ) : (
        <p className="mt-4 text-sm text-ink-mute">
          {elig.eligible
            ? "Seja a primeira pessoa a avaliar este produto."
            : "Este produto ainda não tem avaliações."}
        </p>
      )}

      {logged && elig.eligible && !formOk && (
        <div className="mt-6">
          <button
            type="button"
            onClick={() => setShowForm((v) => !v)}
            className="rounded-full bg-ink px-5 py-2.5 text-sm font-semibold text-primary-50"
          >
            {showForm ? "Fechar avaliação" : "Avaliar este produto"}
          </button>
        </div>
      )}

      {showForm && elig.eligible && !formOk && (
        <form onSubmit={submit} className="mt-4 space-y-4 rounded-xl border border-ink/10 bg-white p-5">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-ink-mute">Sua nota *</p>
            <div className="mt-1.5 flex gap-1">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setRating(n)}
                  aria-label={`${n} de 5 estrelas`}
                  aria-pressed={rating === n}
                >
                  <svg
                    width={28}
                    height={28}
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                    className={n <= rating ? "fill-amber-400" : "fill-ink/15"}
                  >
                    <path d="M12 2l2.9 6.6 7.1.7-5.4 4.8 1.6 7-6.2-3.7-6.2 3.7 1.6-7L2 9.3l7.1-.7z" />
                  </svg>
                </button>
              ))}
            </div>
          </div>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium uppercase tracking-wide text-ink-mute">Título</span>
            <input
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              maxLength={80}
              placeholder="Resuma em poucas palavras"
              className="w-full rounded-lg border border-ink/15 bg-white px-4 py-2.5 text-sm outline-none"
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium uppercase tracking-wide text-ink-mute">
              Sua avaliação *
            </span>
            <textarea
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              required
              minLength={10}
              rows={3}
              placeholder="O que achou do caimento, tecido e qualidade? (mín. 10 caracteres)"
              className="w-full rounded-lg border border-ink/15 bg-white px-4 py-2.5 text-sm outline-none"
            />
          </label>
          <div className="grid grid-cols-3 gap-3">
            <label className="block space-y-1.5">
              <span className="text-xs font-medium uppercase tracking-wide text-ink-mute">Tamanho</span>
              <input
                value={tamanho}
                onChange={(e) => setTamanho(e.target.value)}
                maxLength={10}
                placeholder="M"
                className="w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm outline-none"
              />
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs font-medium uppercase tracking-wide text-ink-mute">Caimento</span>
              <select
                value={caimento}
                onChange={(e) => setCaimento(e.target.value)}
                className="w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm outline-none"
              >
                <option value="">—</option>
                <option value="pequeno">Pequeno</option>
                <option value="ideal">Ideal</option>
                <option value="grande">Grande</option>
              </select>
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs font-medium uppercase tracking-wide text-ink-mute">Sua altura</span>
              <input
                value={altura}
                onChange={(e) => setAltura(e.target.value)}
                maxLength={10}
                placeholder="1,65 m"
                className="w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm outline-none"
              />
            </label>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-ink-mute">
              Fotos (até 3)
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {fotos.map((u, i) => (
                <div key={u} className="relative h-16 w-16 overflow-hidden rounded-lg border border-ink/10">
                  <img src={u} alt="" className="h-full w-full object-cover" />
                  <button
                    type="button"
                    onClick={() => setFotos((f) => f.filter((_, j) => j !== i))}
                    aria-label={`Remover foto ${i + 1}`}
                    className="absolute right-0.5 top-0.5 rounded-full bg-red-600 px-1 text-[10px] text-white"
                  >
                    ×
                  </button>
                </div>
              ))}
              {fotos.length < 3 && (
                <label className="flex h-16 w-16 cursor-pointer items-center justify-center rounded-lg border-2 border-dashed border-ink/20 text-xs text-ink-mute">
                  {uploading ? "..." : "+"}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      handleFiles(e.target.files);
                      e.target.value = "";
                    }}
                  />
                </label>
              )}
            </div>
          </div>
          {formMsg && <p className="text-sm text-red-600">{formMsg}</p>}
          <button
            type="submit"
            disabled={sending}
            className="rounded-full bg-ink px-5 py-2.5 text-sm font-semibold text-primary-50 disabled:opacity-50"
          >
            {sending ? "Enviando..." : "Enviar avaliação"}
          </button>
          <p className="text-[11px] text-ink-mute">
            Sua avaliação passa por moderação antes de aparecer.
          </p>
        </form>
      )}

      {formOk && (
        <p className="mt-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">
          Obrigado! Sua avaliação foi enviada e aparece após moderação.
        </p>
      )}

      {total > 0 && (
        <div className="mt-8">
          <div className="flex flex-wrap items-center gap-3">
            <select
              value={ordem}
              onChange={(e) => {
                setOrdem(e.target.value);
                loadList(1, e.target.value, comFotos);
              }}
              aria-label="Ordenar avaliações"
              className="rounded-full border border-ink/15 bg-white px-3 py-2 text-xs outline-none"
            >
              <option value="recentes">Mais recentes</option>
              <option value="melhores">Melhores notas</option>
            </select>
            <label className="flex items-center gap-1.5 text-xs text-ink-soft">
              <input
                type="checkbox"
                checked={comFotos}
                onChange={(e) => {
                  setComFotos(e.target.checked);
                  loadList(1, ordem, e.target.checked);
                }}
              />
              Com fotos ({summary.comFoto})
            </label>
          </div>

          <div className="mt-4 space-y-4">
            {items.map((r) => (
              <article key={r.id} className="rounded-xl border border-ink/10 bg-white p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Stars value={r.rating} />
                  <span className="text-sm font-semibold text-ink">{r.autor}</span>
                  <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                    Compra verificada
                  </span>
                  <span className="ml-auto text-xs text-ink-mute">
                    {new Date(r.createdAt).toLocaleDateString("pt-BR")}
                  </span>
                </div>
                {r.titulo && <p className="mt-2 text-sm font-semibold text-ink">{r.titulo}</p>}
                <p className="mt-1 whitespace-pre-line text-sm text-ink-soft">{r.texto}</p>
                {(r.tamanhoComprado || r.caimento || r.alturaCliente) && (
                  <p className="mt-2 text-xs text-ink-mute">
                    {[r.tamanhoComprado && `Tamanho: ${r.tamanhoComprado}`,
                      r.caimento && `Caimento: ${r.caimento}`,
                      r.alturaCliente && `Altura: ${r.alturaCliente}`]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                )}
                {r.fotos.length > 0 && (
                  <div className="mt-2 flex gap-2">
                    {r.fotos.map((u, i) => (
                      <img
                        key={i}
                        src={u}
                        alt={`Foto de cliente ${i + 1}`}
                        loading="lazy"
                        className="h-16 w-16 rounded-lg border border-ink/10 object-cover"
                      />
                    ))}
                  </div>
                )}
                {r.respostaLoja && (
                  <div className="mt-3 rounded-lg bg-primary-50 p-3 text-sm">
                    <p className="text-xs font-semibold uppercase tracking-wide text-primary-700">
                      Resposta da loja
                    </p>
                    <p className="mt-1 whitespace-pre-line text-ink-soft">{r.respostaLoja}</p>
                  </div>
                )}
              </article>
            ))}
          </div>

          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-center gap-3 text-sm">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => loadList(page - 1)}
                className="rounded-full border border-ink/15 px-4 py-1.5 disabled:opacity-40"
              >
                ← Anterior
              </button>
              <span className="text-ink-mute">
                {page} / {totalPages}
              </span>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => loadList(page + 1)}
                className="rounded-full border border-ink/15 px-4 py-1.5 disabled:opacity-40"
              >
                Próxima →
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
