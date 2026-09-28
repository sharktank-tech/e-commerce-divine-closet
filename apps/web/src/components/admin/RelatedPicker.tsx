"use client";

import { useEffect, useState } from "react";
import { Input } from "@/components/ui/Input";

type Pick = { id: string; name: string; slug: string };

type Props = {
  value: string[];
  excludeId?: string;
  onChange: (ids: string[]) => void;
};

// Busca produtos e monta a lista de vinculados manualmente.
export function RelatedPicker({ value, excludeId, onChange }: Props) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Pick[]>([]);
  const [selected, setSelected] = useState<Pick[]>([]);
  const [searching, setSearching] = useState(false);

  // resolve nomes dos já vinculados
  useEffect(() => {
    if (value.length === 0) {
      setSelected([]);
      return;
    }
    fetch(`/api/produtos?ids=${value.join(",")}&pageSize=24`)
      .then((r) => r.json())
      .then((d) =>
        setSelected(
          (d.items || []).map((p: Pick) => ({ id: p.id, name: p.name, slug: p.slug }))
        )
      )
      .catch(() => {});
  }, [value.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  async function search() {
    const term = q.trim();
    if (term.length < 2) {
      setResults([]);
      return;
    }
    setSearching(true);
    try {
      const res = await fetch(`/api/produtos?q=${encodeURIComponent(term)}&pageSize=6`);
      const data = await res.json();
      setResults(
        (data.items || [])
          .filter((p: Pick) => p.id !== excludeId && !value.includes(p.id))
          .map((p: Pick) => ({ id: p.id, name: p.name, slug: p.slug }))
      );
    } finally {
      setSearching(false);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {selected.map((p) => (
          <span
            key={p.id}
            className="inline-flex items-center gap-1.5 rounded-full bg-primary-50 px-3 py-1 text-xs font-medium text-primary-800"
          >
            {p.name}
            <button
              type="button"
              onClick={() => onChange(value.filter((id) => id !== p.id))}
              aria-label={`Remover ${p.name} dos vinculados`}
              className="text-ink-mute hover:text-red-600"
            >
              ×
            </button>
          </span>
        ))}
        {selected.length === 0 && (
          <span className="text-xs text-ink-mute">Nenhum vinculado (automático por categoria).</span>
        )}
      </div>
      <div className="mt-2 flex max-w-md gap-2">
        <Input
          label="Buscar produto"
          value={q}
          onChange={setQ}
          placeholder="Nome ou SKU..."
        />
        <div className="flex items-end pb-0.5">
          <button
            type="button"
            onClick={search}
            disabled={searching}
            className="rounded-lg border border-ink/15 px-3 py-2 text-xs font-semibold disabled:opacity-50"
          >
            {searching ? "..." : "Buscar"}
          </button>
        </div>
      </div>
      {results.length > 0 && (
        <ul className="mt-2 max-w-md divide-y divide-ink/5 rounded-lg border border-ink/10 bg-white">
          {results.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => {
                  onChange([...value, p.id]);
                  setResults((r) => r.filter((x) => x.id !== p.id));
                }}
                className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-primary-50"
              >
                <span className="text-ink">{p.name}</span>
                <span className="text-xs text-ink-mute">/{p.slug}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
