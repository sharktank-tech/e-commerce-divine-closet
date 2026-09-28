"use client";

import { Input } from "@/components/ui/Input";

export type ProductContent = {
  composicao: string;
  instrucoesLavagem: string;
  comprimento: string;
  modeloAltura: string;
  modeloVeste: string;
  caimento: string;
  ocasiao: string;
  metaTitle: string;
  metaDescription: string;
};

export const emptyProductContent: ProductContent = {
  composicao: "",
  instrucoesLavagem: "",
  comprimento: "",
  modeloAltura: "",
  modeloVeste: "",
  caimento: "",
  ocasiao: "",
  metaTitle: "",
  metaDescription: "",
};

function Counter({ value, max, hint }: { value: string; max: number; hint: string }) {
  const over = value.length > max;
  return (
    <p className={`mt-1 text-[11px] ${over ? "text-red-600" : "text-ink-mute"}`}>
      {value.length}/{max} — {hint}
    </p>
  );
}

export function ProductContentFields({
  value,
  onChange,
}: {
  value: ProductContent;
  onChange: (v: ProductContent) => void;
}) {
  const set =
    (key: keyof ProductContent) =>
    (v: string): void =>
      onChange({ ...value, [key]: v });

  return (
    <div className="space-y-4 border-t border-ink/10 pt-4">
      <p className="text-xs font-medium uppercase tracking-wide text-ink-mute">
        Conteúdo e SEO (opcional)
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Input
            label="Composição do tecido"
            value={value.composicao}
            onChange={set("composicao")}
            placeholder="95% poliéster, 5% elastano"
          />
        </div>
        <div className="sm:col-span-2">
          <Input
            label="Instruções de lavagem"
            textarea
            rows={2}
            value={value.instrucoesLavagem}
            onChange={set("instrucoesLavagem")}
            placeholder="Lavar à mão com água fria, secar à sombra"
          />
        </div>
        <Input
          label="Comprimento"
          value={value.comprimento}
          onChange={set("comprimento")}
          placeholder="Midi, 110 cm"
        />
        <Input
          label="Ocasião"
          value={value.ocasiao}
          onChange={set("ocasiao")}
          placeholder="Casual, trabalho, festa, praia"
        />
        <Input
          label="Caimento"
          value={value.caimento}
          onChange={set("caimento")}
          placeholder="Solto, ajustado, oversized"
        />
        <div className="grid grid-cols-2 gap-4">
          <Input
            label="Modelo: altura"
            value={value.modeloAltura}
            onChange={set("modeloAltura")}
            placeholder="1,75 m"
          />
          <Input
            label="Modelo: veste"
            value={value.modeloVeste}
            onChange={set("modeloVeste")}
            placeholder="M"
          />
        </div>
        <div className="sm:col-span-2">
          <Input
            label="Meta title (SEO)"
            value={value.metaTitle}
            onChange={set("metaTitle")}
            placeholder="Deixe vazio para gerar automaticamente"
          />
          <Counter value={value.metaTitle} max={60} hint="ideal até 60 caracteres" />
        </div>
        <div className="sm:col-span-2">
          <Input
            label="Meta description (SEO)"
            textarea
            rows={2}
            value={value.metaDescription}
            onChange={set("metaDescription")}
            placeholder="Deixe vazio para gerar da descrição"
          />
          <Counter value={value.metaDescription} max={160} hint="ideal 140–160 caracteres" />
        </div>
      </div>
    </div>
  );
}
