"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { describeAlt, findColorIndex } from "@/lib/imagens";

export const COLOR_SELECT_EVENT = "dc:select-color";

type Props = {
  images: string[];
  name: string;
  className?: string;
  intervalMs?: number;
  /** cores paralelas às imagens ("" = todas); ao trocar de cor, salta para a foto */
  imageColors?: (string | null)[];
  /** alts paralelos (vazio = gerado) */
  imageAlts?: (string | null)[];
  /** miniaturas clicáveis abaixo da foto */
  thumbs?: boolean;
  /** clique abre lightbox */
  zoomable?: boolean;
};

// Galeria: alterna no hover, swipe no mobile, thumbs, lightbox e salto por cor.
// Sem imagens: placeholder da marca.
export function ProductSlideshow({
  images,
  name,
  className,
  intervalMs = 1200,
  imageColors = [],
  imageAlts = [],
  thumbs = false,
  zoomable = false,
}: Props) {
  const [index, setIndex] = useState(0);
  const [lightbox, setLightbox] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const touchX = useRef<number | null>(null);

  const go = useCallback(
    (i: number) => {
      if (images.length === 0) return;
      setIndex(((i % images.length) + images.length) % images.length);
    },
    [images.length]
  );

  function stop() {
    if (timer.current) {
      clearInterval(timer.current);
      timer.current = null;
    }
    setIndex(0);
  }

  function start() {
    if (images.length < 2 || timer.current) return;
    timer.current = setInterval(() => {
      setIndex((i) => (i + 1) % images.length);
    }, intervalMs);
  }

  // salto para a foto da cor selecionada (evento vindo do seletor)
  useEffect(() => {
    function onColor(e: Event) {
      const color = (e as CustomEvent<string>).detail || "";
      const i = findColorIndex(imageColors, color);
      if (i >= 0) {
        if (timer.current) {
          clearInterval(timer.current);
          timer.current = null;
        }
        setIndex(i);
      }
    }
    window.addEventListener(COLOR_SELECT_EVENT, onColor);
    return () => window.removeEventListener(COLOR_SELECT_EVENT, onColor);
  }, [imageColors]);

  useEffect(() => {
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, []);

  // lightbox: ESC fecha + trava scroll
  useEffect(() => {
    if (!lightbox) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setLightbox(false);
      if (e.key === "ArrowRight") go(index + 1);
      if (e.key === "ArrowLeft") go(index - 1);
    }
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [lightbox, go, index]);

  function onTouchStart(e: React.TouchEvent) {
    touchX.current = e.touches[0].clientX;
  }

  function onTouchEnd(e: React.TouchEvent) {
    if (touchX.current == null) return;
    const dx = e.changedTouches[0].clientX - touchX.current;
    touchX.current = null;
    if (Math.abs(dx) < 40 || images.length < 2) return;
    if (timer.current) {
      clearInterval(timer.current);
      timer.current = null;
    }
    go(index + (dx < 0 ? 1 : -1));
  }

  if (images.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-primary-400">
        <span className="font-display text-6xl">DC</span>
      </div>
    );
  }

  const altFor = (i: number) =>
    describeAlt(name, i, imageColors[i] || null, imageAlts[i] || null);

  return (
    <>
      <div
        className="relative h-full w-full overflow-hidden"
        onMouseEnter={start}
        onMouseLeave={stop}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        {images.map((src, i) => (
          <img
            key={`${src}-${i}`}
            src={src}
            alt={altFor(i)}
            loading={i === 0 ? undefined : "lazy"}
            onClick={() => zoomable && setLightbox(true)}
            className={`absolute inset-0 h-full w-full object-cover transition-transform duration-700 ease-in-out ${
              className || ""
            } ${zoomable ? "cursor-zoom-in" : ""}`}
            style={{ transform: `translateX(${(i - index) * 100}%)` }}
          />
        ))}
        {images.length > 1 && !thumbs && (
          <div className="absolute inset-x-0 bottom-2 flex justify-center gap-1.5">
            {images.map((_, i) => (
              <span
                key={i}
                className={`h-1.5 rounded-full transition-all ${
                  i === index ? "w-4 bg-white" : "w-1.5 bg-white/50"
                }`}
              />
            ))}
          </div>
        )}
        {thumbs && images.length > 1 && (
          <div className="absolute inset-x-0 bottom-2 flex justify-center gap-1.5 px-3">
            {images.map((src, i) => (
              <button
                key={`${src}-t${i}`}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (timer.current) {
                    clearInterval(timer.current);
                    timer.current = null;
                  }
                  setIndex(i);
                }}
                aria-label={`Ver foto ${i + 1} de ${images.length}`}
                aria-pressed={i === index}
                className={`h-10 w-10 shrink-0 overflow-hidden rounded-md border-2 transition-all ${
                  i === index ? "border-white" : "border-white/40 opacity-70"
                }`}
              >
                <img src={src} alt="" loading="lazy" className="h-full w-full object-cover" />
              </button>
            ))}
          </div>
        )}
      </div>

      {zoomable && lightbox && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/90 p-4"
          onClick={() => setLightbox(false)}
          role="presentation"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`${name} — foto ${index + 1} de ${images.length}`}
            className="relative max-h-[90vh] w-full max-w-3xl"
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={images[index]}
              alt={altFor(index)}
              className="max-h-[80vh] w-full rounded-xl object-contain"
            />
            <p className="mt-2 text-center text-sm text-white/80">
              {index + 1} / {images.length}
            </p>
            <button
              type="button"
              onClick={() => setLightbox(false)}
              aria-label="Fechar ampliação"
              className="absolute -top-2 right-0 rounded-full bg-white p-2 text-ink"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
            {images.length > 1 && (
              <>
                <button
                  type="button"
                  onClick={() => go(index - 1)}
                  aria-label="Foto anterior"
                  className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-white/90 p-2.5 text-ink"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <path d="M15 18l-6-6 6-6" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={() => go(index + 1)}
                  aria-label="Próxima foto"
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-white/90 p-2.5 text-ink"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <path d="M9 6l6 6-6 6" />
                  </svg>
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
