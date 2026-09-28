"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SizeTableData } from "@/lib/medidas";
import { medidaNotaPadrao } from "@/config/defaults";

type Props = {
  table: SizeTableData;
  selectedSize?: string;
};

// Link "Guia de medidas" + modal acessível (ESC, overlay, foco no fechar).
export function GuiaMedidas({ table, selectedSize }: Props) {
  const [open, setOpen] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const selected = (selectedSize || "").trim().toUpperCase();

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, close]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs font-semibold text-primary-700 underline hover:text-primary-800"
      >
        Guia de medidas
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-ink/60 p-0 sm:items-center sm:p-6"
          onClick={close}
          role="presentation"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`Guia de medidas — ${table.name}`}
            className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-6 sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="font-display text-xl font-bold text-ink">
                  Guia de medidas
                </h2>
                <p className="mt-1 text-xs text-ink-mute">
                  {table.name} · unidade em {table.unit}
                </p>
              </div>
              <button
                ref={closeRef}
                type="button"
                onClick={close}
                aria-label="Fechar guia de medidas"
                className="rounded-full p-2 text-ink-soft hover:bg-ink/5"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="mt-4 overflow-x-auto rounded-xl border border-ink/10">
              <table className="w-full text-sm">
                <thead className="bg-primary-50">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs uppercase text-ink-mute">Tam.</th>
                    {table.columns.map((c) => (
                      <th key={c.key} className="px-3 py-2 text-left text-xs uppercase text-ink-mute">
                        {c.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {table.rows.map((r) => {
                    const active =
                      selected !== "" && r.size.trim().toUpperCase() === selected;
                    return (
                      <tr
                        key={r.size}
                        className={active ? "bg-primary-100 font-semibold" : "border-t border-ink/5"}
                      >
                        <td className="px-3 py-2 text-ink">{r.size}</td>
                        {table.columns.map((c) => (
                          <td key={c.key} className="px-3 py-2 text-ink-soft">
                            {r.values[c.key] || "—"}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <p className="mt-3 text-xs text-ink-mute">{table.note || medidaNotaPadrao}</p>
          </div>
        </div>
      )}
    </>
  );
}
