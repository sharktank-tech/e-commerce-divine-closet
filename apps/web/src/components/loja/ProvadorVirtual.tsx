"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Props = { productId: string; productName: string; productImage: string; productSlug: string };
export function ProvadorVirtual({ productId, productName, productImage, productSlug }: Props) {
  const [photo, setPhoto] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState("");
  const [error, setError] = useState("");

  useEffect(() => () => { setPhoto(""); setResult(""); }, []);

  async function selectPhoto(file?: File) {
    setResult(""); setError("");
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 4 * 1024 * 1024) {
      setPhoto(""); setError("Escolha uma foto JPG, PNG ou WebP de até 4 MB."); return;
    }
    const reader = new FileReader();
    reader.onload = () => setPhoto(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => setError("Não foi possível abrir a foto.");
    reader.readAsDataURL(file);
  }

  async function generate() {
    if (!photo || !consent || busy) return;
    setBusy(true); setError(""); setResult("");
    try {
      const res = await fetch("/api/provador", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId, modelImage: photo, consent: true }),
      });
      const body = await res.json();
      if (!res.ok || !body.id) throw new Error(body.error || "Falha ao gerar imagem.");
      let completed = false;
      for (let i = 0; i < 40; i++) {
        await new Promise((resolve) => setTimeout(resolve, 3000));
        const response = await fetch(`/api/provador/${encodeURIComponent(body.id)}`, { cache: "no-store" });
        const data = await response.json();
        if (!response.ok || data.status === "failed") throw new Error(data.error || "Falha na geração.");
        if (data.status === "completed") { setResult(data.output); completed = true; break; }
      }
      if (!completed) throw new Error("A geração demorou mais que o esperado. Tente novamente.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ocorreu um erro inesperado.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-8 rounded-2xl border border-primary-200 bg-primary-50 p-5 sm:p-7" aria-labelledby="provador-title">
      <p className="text-xs font-semibold uppercase tracking-widest text-primary-700">Experiência Divine Closet</p>
      <h2 id="provador-title" className="mt-1 font-display text-2xl font-bold text-ink">Provador virtual ✨</h2>
      <p className="mt-2 text-sm text-ink-soft">Envie uma foto sua para visualizar uma simulação usando {productName}.</p>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <div>
          <p className="mb-2 text-xs font-semibold text-ink">Peça selecionada</p>
          {productImage ? <img src={productImage} alt={productName} className="h-72 w-full rounded-xl bg-white object-contain" /> : null}
          <Link href={`/produtos/${productSlug}`} className="mt-2 inline-block text-xs text-primary-700 underline">Ver detalhes do produto</Link>
        </div>
        <div>
          <label htmlFor="provador-foto" className="mb-2 block text-xs font-semibold text-ink">Sua foto (corpo visível, boa iluminação)</label>
          <input id="provador-foto" type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => void selectPhoto(e.target.files?.[0])} className="block w-full text-xs text-ink" disabled={busy} />
          {photo && <img src={photo} alt="Prévia da foto enviada" className="mt-3 h-56 w-full rounded-xl bg-white object-contain" />}
        </div>
      </div>
      <label className="mt-5 flex items-start gap-2 text-xs leading-relaxed text-ink-soft">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5" />
        Autorizo o envio desta foto à FASHN AI exclusivamente para gerar a simulação. A imagem não será salva no catálogo da Divine Closet.
      </label>
      <p className="mt-2 text-xs text-ink-mute">Resultado ilustrativo gerado por IA: não garante tamanho, caimento ou fidelidade exata das cores. Não envie fotos de terceiros sem autorização.</p>
      <button type="button" disabled={!photo || !consent || busy} onClick={() => void generate()}
        className="mt-4 w-full rounded-full bg-ink px-6 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40">
        {busy ? "Gerando sua simulação…" : "Experimentar virtualmente"}
      </button>
      {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
      {result && <div className="mt-6"><h3 className="mb-3 font-display text-xl font-semibold">Sua simulação</h3>
        <img src={result} alt={`Simulação virtual de ${productName}`} className="mx-auto max-h-[620px] w-full rounded-xl bg-white object-contain" />
        <a href={result} download="divine-closet-provador.jpg" className="mt-3 inline-block text-sm font-semibold text-primary-700 underline">Salvar imagem</a>
      </div>}
    </section>
  );
}
