"use client";

import { useState } from "react";
import { formatBRL } from "@/lib/utils";

type FreteResult = {
  cep: string;
  freeShipping: boolean;
  freeFrom: number;
  delivery: Array<{ id: string; name: string; price: number; days: string; eta: string }>;
};

export function FreteEstimator({ subtotal }: { subtotal: number }) {
  const [cep, setCep] = useState("");
  const [result, setResult] = useState<FreteResult | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function check(e?: React.FormEvent) {
    e?.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch(
        `/api/frete?cep=${encodeURIComponent(cep)}&subtotal=${subtotal}`
      );
      const data = await res.json();
      if (!res.ok) {
        setResult(null);
        setError(data.error || "Erro ao calcular frete");
        return;
      }
      setResult(data);
    } catch {
      setError("Erro de conexão");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-xl border border-ink/10 bg-primary-50 p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
        Calcular frete (CEP)
      </p>
      <form onSubmit={check} className="mt-2 flex gap-2">
        <input
          value={cep}
          onChange={(e) => {
            const v = e.target.value.replace(/\D/g, "").slice(0, 8);
            setCep(v.length > 5 ? `${v.slice(0, 5)}-${v.slice(5)}` : v);
          }}
          placeholder="00000-000"
          inputMode="numeric"
          className="w-36 rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm outline-none focus:border-ink/40"
        />
        <button
          type="submit"
          disabled={loading || cep.replace(/\D/g, "").length !== 8}
          className="rounded-lg bg-ink px-4 py-2 text-xs font-semibold text-primary-50 disabled:opacity-50"
        >
          {loading ? "..." : "Calcular"}
        </button>
      </form>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      {result && (
        <div className="mt-3 space-y-1.5 text-sm">
          {result.delivery.map((d) => (
            <div key={d.id} className="flex items-center justify-between gap-3">
              <span className="text-ink-soft">
                {d.name} · {d.eta}
              </span>
              <span className={d.price === 0 ? "font-semibold text-emerald-700" : "font-semibold"}>
                {d.price === 0 ? "Grátis" : formatBRL(d.price)}
              </span>
            </div>
          ))}
          {!result.freeShipping && (
            <p className="text-[11px] text-ink-mute">
              Frete grátis em compras acima de {formatBRL(result.freeFrom)}.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
