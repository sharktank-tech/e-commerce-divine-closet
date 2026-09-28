"use client";

import { useState } from "react";

type Props = {
  images: string[];
  colors: string[];
  alts: string[];
  colorOptions: string[];
  onChange: (images: string[], colors: string[], alts: string[]) => void;
  onUpload: (file: File) => Promise<string | null>;
};

// Editor: upload múltiplo, ordem, principal, cor vinculada e alt por imagem.
export function ProductImagesEditor({
  images,
  colors,
  alts,
  colorOptions,
  onChange,
  onUpload,
}: Props) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  function at(i: number) {
    return {
      src: images[i],
      color: colors[i] || "",
      alt: alts[i] || "",
    };
  }

  function setAll(next: { src: string; color: string; alt: string }[]) {
    onChange(
      next.map((x) => x.src),
      next.map((x) => x.color),
      next.map((x) => x.alt)
    );
  }

  function list(): { src: string; color: string; alt: string }[] {
    return images.map((_, i) => at(i));
  }

  function move(i: number, dir: -1 | 1) {
    const l = list();
    const j = i + dir;
    if (j < 0 || j >= l.length) return;
    const [x] = l.splice(i, 1);
    l.splice(j, 0, x);
    setAll(l);
  }

  function makeMain(i: number) {
    const l = list();
    const [x] = l.splice(i, 1);
    l.unshift(x);
    setAll(l);
  }

  function remove(i: number) {
    setAll(list().filter((_, j) => j !== i));
  }

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError("");
    setUploading(true);
    try {
      const urls: string[] = [];
      for (const f of Array.from(files)) {
        const url = await onUpload(f);
        if (url) urls.push(url);
      }
      if (urls.length > 0) {
        setAll([...list(), ...urls.map((src) => ({ src, color: "", alt: "" }))]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro no upload");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap gap-3">
        {list().map((img, i) => (
          <div
            key={`${img.src}-${i}`}
            className="w-40 overflow-hidden rounded-lg border border-ink/10 bg-white"
          >
            <div className="relative h-24 overflow-hidden bg-primary-100">
              <img src={img.src} alt={img.alt || `Imagem ${i + 1}`} className="h-full w-full object-cover" />
              {i === 0 && (
                <span className="absolute left-1 top-1 rounded-full bg-ink px-2 py-0.5 text-[10px] font-bold text-white">
                  Principal
                </span>
              )}
              <button
                type="button"
                onClick={() => remove(i)}
                aria-label={`Remover imagem ${i + 1}`}
                className="absolute right-1 top-1 rounded-full bg-red-600 px-1.5 text-xs text-white"
              >
                ×
              </button>
            </div>
            <div className="space-y-1.5 p-2">
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => move(i, -1)}
                  disabled={i === 0}
                  aria-label="Mover para a esquerda"
                  className="rounded border border-ink/15 px-1.5 text-xs disabled:opacity-30"
                >
                  ←
                </button>
                <button
                  type="button"
                  onClick={() => move(i, 1)}
                  disabled={i === list().length - 1}
                  aria-label="Mover para a direita"
                  className="rounded border border-ink/15 px-1.5 text-xs disabled:opacity-30"
                >
                  →
                </button>
                {i !== 0 && (
                  <button
                    type="button"
                    onClick={() => makeMain(i)}
                    className="rounded border border-ink/15 px-1.5 text-xs"
                    title="Marcar como principal"
                  >
                    ★
                  </button>
                )}
              </div>
              <select
                value={img.color}
                onChange={(e) => {
                  const l = list();
                  l[i] = { ...l[i], color: e.target.value };
                  setAll(l);
                }}
                aria-label={`Cor da imagem ${i + 1}`}
                className="w-full rounded border border-ink/15 bg-white px-1.5 py-1 text-xs outline-none"
              >
                <option value="">Todas as cores</option>
                {colorOptions.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <input
                value={img.alt}
                onChange={(e) => {
                  const l = list();
                  l[i] = { ...l[i], alt: e.target.value };
                  setAll(l);
                }}
                placeholder="Alt (auto se vazio)"
                aria-label={`Texto alternativo da imagem ${i + 1}`}
                className="w-full rounded border border-ink/15 bg-white px-1.5 py-1 text-xs outline-none"
              />
            </div>
          </div>
        ))}
        <label className="flex h-24 w-24 cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-ink/20 text-xs text-ink-mute hover:border-primary-400">
          {uploading ? "..." : "+ Enviar"}
          <input
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              handleFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </label>
      </div>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      <p className="mt-2 text-xs text-ink-mute">
        JPG, PNG, WEBP ou GIF — máx 5MB cada. A primeira é a principal. A cor vinculada faz a galeria pular para a foto ao trocar de cor na loja.
      </p>
    </div>
  );
}
