"use client";

import { useState, useRef, useEffect, useCallback, useId } from "react";
import { useRouter, useSearchParams } from "next/navigation";

type Props = {
  basePath: string;
  q: string;
  categoria: string;
  lockedCategoria?: string;
  sort: string;
  precoMin: number;
  precoMax: number;
  soEstoque: boolean;
  filtrosAtivos: number;
};

export function CatalogoFiltros({
  basePath,
  q,
  categoria,
  lockedCategoria,
  sort,
  precoMin,
  precoMax,
  soEstoque,
  filtrosAtivos,
}: Props) {
  const [open, setOpen] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const router = useRouter();
  const searchParams = useSearchParams();

  const priceMinId = useId();
  const priceMaxId = useId();

  // O foco só é movido quando o drawer abre: nunca roubar foco no mount.
  // Restaurar o overflow anterior preserva overlays que controlam o scroll.
  useEffect(() => {
    if (!open || !drawerRef.current) return;
    const panel = drawerRef.current;
    const opener = triggerRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const focusables = () =>
      Array.from(panel.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )).filter((node) => {
        const style = window.getComputedStyle(node);
        return !node.hidden && !node.closest("[inert]") &&
          style.display !== "none" && style.visibility !== "hidden";
      });

    focusables()[0]?.focus();

    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const elements = focusables();
      if (elements.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (event.shiftKey && (document.activeElement === first || !panel.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !panel.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    }

    function onFocusIn(event: FocusEvent) {
      if (!panel.contains(event.target as Node)) focusables()[0]?.focus();
    }

    document.addEventListener("keydown", onKey);
    document.addEventListener("focusin", onFocusIn);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("focusin", onFocusIn);
      document.body.style.overflow = previousOverflow;
      if (opener?.isConnected) opener.focus();
    };
  }, [open]);

  const buildUrl = useCallback(
    (overrides: Record<string, string | null>) => {
      const usp = new URLSearchParams(searchParams.toString());
      // Reset pagination on filter change
      usp.delete("page");
      for (const [k, v] of Object.entries(overrides)) {
        if (v === null) usp.delete(k);
        else usp.set(k, v);
      }
      const s = usp.toString();
      return `${basePath}${s ? `?${s}` : ""}`;
    },
    [basePath, searchParams]
  );

  const handleApply = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const minimum = String(values.get("preco_min") ?? "").trim();
    const maximum = String(values.get("preco_max") ?? "").trim();
    // Navegação client-side explícita: mantemos filtros e parâmetros da rota
    // (inclusive oferta=1) e geramos URL reproduzível antes de atualizar chips.
    router.push(buildUrl({
      q: q || null,
      ...(lockedCategoria ? {} : { categoria: categoria || null }),
      sort: sort === "recent" ? null : sort,
      preco_min: minimum || null,
      preco_max: maximum || null,
      estoque: values.has("estoque") ? "1" : null,
    }));
    setOpen(false);
  };

  const handleClear = useCallback(() => {
    router.push(basePath);
    setOpen(false);
  }, [basePath, router]);

  // Chips de filtros ativos
  const chips: { label: string; remove: () => void }[] = [];
  if (q) {
    chips.push({ label: `Busca: ${q}`, remove: () => router.push(buildUrl({ q: null })) });
  }
  if (categoria && !lockedCategoria) {
    chips.push({ label: `Categoria: ${categoria}`, remove: () => router.push(buildUrl({ categoria: null })) });
  }
  if (precoMin > 0) {
    chips.push({ label: `Mín: R$${precoMin}`, remove: () => router.push(buildUrl({ preco_min: null })) });
  }
  if (precoMax > 0) {
    chips.push({ label: `Máx: R$${precoMax}`, remove: () => router.push(buildUrl({ preco_max: null })) });
  }
  if (soEstoque) {
    chips.push({ label: "Em estoque", remove: () => router.push(buildUrl({ estoque: null })) });
  }

  return (
    <>
      {/* Barra compacta de filtros */}
      <div className="mt-3 flex w-full flex-col gap-2 sm:w-auto">
        <div className="flex flex-wrap items-center gap-2">
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setOpen(true)}
          className="flex items-center gap-1.5 rounded-full border border-ink/15 bg-white px-4 py-2 text-sm font-medium min-h-[44px]"
          aria-expanded={open}
          aria-controls="filter-drawer"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
          </svg>
          Filtros
          {filtrosAtivos > 0 && (
            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-ink text-[10px] font-bold text-primary-50">
              {filtrosAtivos}
            </span>
          )}
        </button>

        <select
          aria-label="Ordenar produtos"
          value={sort}
          onChange={(e) => router.push(buildUrl({ sort: e.target.value === "recent" ? null : e.target.value }))}
          className="rounded-full border border-ink/15 bg-white px-3 py-2 text-sm outline-none min-h-[40px]"
        >
          <option value="recent">Lançamentos</option>
          <option value="desconto">Maior desconto</option>
          <option value="sales">Mais vendidos</option>
          <option value="price_asc">Menor preço</option>
          <option value="price_desc">Maior preço</option>
        </select>

        </div>

        {/* Chips de filtros ativos, separados da linha de controles para não comprimir o mobile */}
        {chips.length > 0 && (
          <div className="flex flex-wrap gap-1.5" aria-label="Filtros ativos">
            {chips.map((chip, i) => (
              <button
                key={i}
                type="button"
                onClick={chip.remove}
                aria-label={`Remover ${chip.label}`}
                className="inline-flex items-center gap-1 rounded-full bg-ink/5 border border-ink/10 px-3 py-1 text-xs font-medium text-ink-soft hover:bg-ink/10"
              >
                {chip.label}
                <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Drawer de filtros */}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center sm:justify-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="filter-drawer-title"
        >
          {/* Overlay */}
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          {/* Painel */}
          <div
            ref={drawerRef}
            id="filter-drawer"
            tabIndex={-1}
            className="relative w-full max-h-[85vh] sm:max-w-md sm:max-h-[80vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl bg-white p-5 shadow-xl"
          >
            <div className="flex items-center justify-between mb-4">
              <h2 id="filter-drawer-title" className="text-lg font-semibold text-ink">
                Filtrar produtos
              </h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="p-2 rounded-full hover:bg-ink/5"
                aria-label="Fechar filtros"
              >
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <form
              action={basePath}
              className="flex flex-col gap-4"
              onSubmit={handleApply}
              key={`${q}|${categoria}|${sort}|${precoMin}|${precoMax}|${soEstoque}`}
            >
              {categoria && !lockedCategoria && (
                <input type="hidden" name="categoria" value={categoria} />
              )}
              <input type="hidden" name="q" value={q} />
              <input type="hidden" name="sort" value={sort} />
              {searchParams.get("oferta") === "1" && <input type="hidden" name="oferta" value="1" />}

              <div>
                <label htmlFor={priceMinId} className="block text-sm font-medium text-ink mb-1">Preço mínimo (R$)</label>
                <input
                  id={priceMinId}
                  name="preco_min"
                  defaultValue={precoMin > 0 ? String(precoMin) : ""}
                  placeholder="Mín."
                  inputMode="numeric"
                  className="w-full rounded-lg border border-ink/15 bg-white px-3 py-2.5 text-sm outline-none"
                />
              </div>

              <div>
                <label htmlFor={priceMaxId} className="block text-sm font-medium text-ink mb-1">Preço máximo (R$)</label>
                <input
                  id={priceMaxId}
                  name="preco_max"
                  defaultValue={precoMax > 0 ? String(precoMax) : ""}
                  placeholder="Máx."
                  inputMode="numeric"
                  className="w-full rounded-lg border border-ink/15 bg-white px-3 py-2.5 text-sm outline-none"
                />
              </div>

              <label className="flex items-center gap-2 text-sm text-ink-soft">
                <input type="checkbox" name="estoque" value="1" defaultChecked={soEstoque} className="h-4 w-4" />
                Apenas em estoque
              </label>

              <div className="flex gap-2 pt-2">
                <button
                  type="submit"
                  className="flex-1 rounded-full bg-ink px-4 py-2.5 text-sm font-semibold text-primary-50 min-h-[44px]"
                >
                  Aplicar filtros
                </button>
                <button
                  type="button"
                  onClick={handleClear}
                  className="rounded-full border border-ink/15 px-4 py-2.5 text-sm font-medium text-ink-soft min-h-[44px]"
                >
                  Limpar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
