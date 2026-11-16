"use client";

import { useEffect, useRef, useState } from "react";

type Banner = {
  id: string;
  title: string;
  subtitle?: string | null;
  imageUrl: string;
  linkUrl?: string | null;
};

const bannerTextShadow = "0 2px 8px rgba(0, 0, 0, 0.95), 1px 1px 2px rgba(0, 0, 0, 0.95), -1px -1px 2px rgba(0, 0, 0, 0.95)";

export function BannerCarousel({ banners }: { banners: Banner[] }) {
  const [index, setIndex] = useState(0);
  const touchStartX = useRef<number | null>(null);
  const swiped = useRef(false);

  useEffect(() => {
    if (banners.length <= 1) return;
    const t = setInterval(() => setIndex((i) => (i + 1) % banners.length), 5000);
    return () => clearInterval(t);
  }, [banners.length]);

  if (banners.length === 0) return null;
  const current = index % banners.length;
  const b = banners[current];
  const multiple = banners.length > 1;
  const previous = () => setIndex((i) => (i - 1 + banners.length) % banners.length);
  const next = () => setIndex((i) => (i + 1) % banners.length);

  function onTouchStart(e: React.TouchEvent) {
    touchStartX.current = e.touches[0]?.clientX ?? null;
    swiped.current = false;
  }

  function onTouchEnd(e: React.TouchEvent) {
    if (!multiple || touchStartX.current === null) return;
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    touchStartX.current = null;
    if (Math.abs(dx) < 45) return;
    swiped.current = true;
    setIndex((i) => (i + (dx < 0 ? 1 : banners.length - 1)) % banners.length);
  }

  const content = (
    <div className="relative aspect-[5/4] w-full overflow-hidden bg-primary-100 sm:aspect-[16/6]">
      <img src={b.imageUrl} alt={b.title} className="h-full w-full object-cover" />
      <div className="pointer-events-none absolute inset-x-4 bottom-4 sm:inset-x-10 sm:bottom-10">
        <div className="flex max-w-full flex-col gap-1.5 sm:max-w-lg">
          <h2 className="font-display text-xl font-bold leading-snug text-white sm:text-3xl" style={{ textShadow: bannerTextShadow }}>
            {b.title}
          </h2>
          {b.subtitle && <p className="text-sm font-medium leading-relaxed text-white" style={{ textShadow: bannerTextShadow }}>{b.subtitle}</p>}
        </div>
      </div>
    </div>
  );

  const arrowBase =
    "flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-ink/10 bg-white text-ink shadow-sm transition-colors hover:bg-primary-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-700";

  return (
    <section className="w-full pt-4 sm:pt-8" aria-label="Banners promocionais">
      <div
        className="relative touch-pan-y"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        onClickCapture={(e) => {
          if (swiped.current) {
            e.preventDefault();
            e.stopPropagation();
            swiped.current = false;
          }
        }}
      >
        {b.linkUrl ? <a href={b.linkUrl} className="block">{content}</a> : content}

        {multiple && (
          <>
            <button
              type="button"
              onClick={previous}
              aria-label="Banner anterior"
              className={`absolute left-4 top-1/2 hidden -translate-y-1/2 sm:flex ${arrowBase}`}
            >
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
                <path d="m15 18-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <button
              type="button"
              onClick={next}
              aria-label="Próximo banner"
              className={`absolute right-4 top-1/2 hidden -translate-y-1/2 sm:flex ${arrowBase}`}
            >
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
                <path d="m9 18 6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </>
        )}
      </div>

      {multiple && (
        <div className="mt-3 flex items-center justify-between gap-2 sm:justify-center">
          <button type="button" onClick={previous} aria-label="Banner anterior" className={`sm:hidden ${arrowBase}`}>
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
              <path d="m15 18-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <div className="flex min-w-0 items-center justify-center gap-1" aria-label="Selecionar banner">
            {banners.map((x, i) => (
              <button
                key={x.id}
                type="button"
                onClick={() => setIndex(i)}
                aria-label={`Ir para o banner ${i + 1}`}
                aria-current={i === current ? "true" : undefined}
                className="flex h-11 min-w-6 items-center justify-center rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-700"
              >
                <span className={`block h-2 rounded-full transition-all ${i === current ? "w-5 bg-ink" : "w-2 bg-ink/30"}`} />
              </button>
            ))}
          </div>
          <button type="button" onClick={next} aria-label="Próximo banner" className={`sm:hidden ${arrowBase}`}>
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
              <path d="m9 18 6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      )}
    </section>
  );
}
