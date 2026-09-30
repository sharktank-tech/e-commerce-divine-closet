"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

type Categoria = {
  id: string;
  name: string;
  slug: string;
  image?: string | null;
};

export function CarrosselCategorias({ categorias }: { categorias: Categoria[] }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    setIsDesktop(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  function scrollByStep(dir: number) {
    trackRef.current?.scrollBy({ left: dir * 300, behavior: "smooth" });
  }

  return (
    <>
      {/* Container do carrossel com scroll suave */}
      <div
        ref={trackRef}
        className="carousel-track overflow-x-auto overflow-y-hidden"
        style={{ scrollBehavior: "smooth" }}
      >
        <div className="carousel-card flex gap-2 min-w-min">
          {categorias.map((c) => (
            <Link
              key={c.id}
              href={`/categoria/${c.slug}`}
              className="flex w-44 flex-col shrink-0 rounded-xl border border-ink/10 bg-white overflow-hidden hover:border-primary-400 hover:shadow-md transition-all duration-200"
              aria-label={c.name}
            >
              {c.image ? (
                <div className="aspect-[4/3] overflow-hidden bg-primary-100">
                  <img
                    src={c.image}
                    alt={c.name}
                    loading="lazy"
                    className="h-full w-full object-cover transition-transform duration-500 hover:scale-105"
                  />
                </div>
              ) : (
                <div className="flex aspect-[4/3] items-center justify-center bg-gradient-to-br from-primary-200 via-primary-100 to-primary-50">
                  <span className="font-display text-3xl font-bold text-primary-700">
                    {c.name.charAt(0)}
                  </span>
                </div>
              )}
              <p className="p-2 font-medium text-ink">{c.name}</p>
            </Link>
          ))}
        </div>
      </div>

      {/* Setas de navegação (apenas desktop, >=768px) */}
      {isDesktop && (
        <div className="mt-4 flex items-center justify-between">
          <button
            type="button"
            className="prev-btn rounded-full bg-primary-50 px-3 py-1 text-ink-mute hover:text-ink transition-colors"
            aria-label="Categoria anterior"
            onClick={() => scrollByStep(-1)}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
          <button
            type="button"
            className="next-btn rounded-full bg-primary-50 px-3 py-1 text-ink-mute hover:text-ink transition-colors"
            aria-label="Próxima categoria"
            onClick={() => scrollByStep(1)}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M10 8l8 8-8 8" />
            </svg>
          </button>
        </div>
      )}
    </>
  );
}
