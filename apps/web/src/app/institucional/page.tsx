import type { Metadata } from "next";
import { institutional } from "@/config/defaults";
import { Button } from "@/components/ui/Button";

export const metadata: Metadata = {
  title: "Sobre nós",
  description: "Conheça a Divine Closet",
};

export default function InstitucionalPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-14 sm:px-6">
      <h1 className="font-display text-3xl font-bold text-primary">Sobre a Divine Closet</h1>
      <p className="mt-6 whitespace-pre-line leading-relaxed text-ink-soft">
        {institutional.about}
      </p>

      <div className="mt-10 grid gap-4 sm:grid-cols-3">
        {[
          { t: "Curadoria", d: "Peças selecionadas com critério." },
          { t: "Entrega", d: "Envio para todo o Brasil." },
          { t: "Troca fácil", d: "30 dias para se arrepender." },
        ].map((f) => (
          <div key={f.t} className="rounded-xl border border-ink/10 bg-white p-5">
            <p className="font-semibold text-primary">{f.t}</p>
            <p className="mt-1 text-sm text-ink-mute">{f.d}</p>
          </div>
        ))}
      </div>

      <div className="mt-10 flex gap-3">
        <Button href="/produtos">Ver coleção</Button>
        <Button href="/contato" variant="outline">
          Fale conosco
        </Button>
      </div>
    </div>
  );
}
