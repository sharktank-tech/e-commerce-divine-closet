import type { Metadata } from "next";
import { institutional } from "@/config/defaults";

export const metadata: Metadata = {
  title: "Trocas e devoluções",
};

export default function TrocasPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-14 sm:px-6">
      <h1 className="font-display text-3xl font-bold text-primary">
        Trocas e devoluções
      </h1>
      <p className="mt-6 whitespace-pre-line leading-relaxed text-ink-soft">
        {institutional.exchangePolicy}
      </p>
      <div className="mt-8 rounded-xl border border-accent-200 bg-accent-50 p-5 text-sm text-accent-800">
        Prazo de referência: 30 dias a partir do recebimento. Produtos com etiqueta
        e sem sinais de uso.
      </div>
    </div>
  );
}
