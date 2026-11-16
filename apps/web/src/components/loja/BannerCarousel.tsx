"use client";

import { useEffect, useState } from "react";

type Banner = {
  id: string;
  title: string;
  subtitle?: string | null;
  imageUrl: string;
  linkUrl?: string | null;
};

const bannerTextShadow =
  "0 2px 8px rgba(0, 0, 0, 0.9), 1px 1px 1px rgba(0, 0, 0, 0.95), -1px -1px 1px rgba(0, 0, 0, 0.95)";

export function BannerCarousel({ banners }: { banners: Banner[] }) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (banners.length <= 1) return;
    const t = setInterval(() => setIndex((i) => (i + 1) % banners.length), 5000);
    return () => clearInterval(t);
  }, [banners.length]);

  if (banners.length === 0) return null;
  const b = banners[index % banners.length];

  const content = (
    <div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl bg-primary-100 sm:aspect-[16/6]">
      <img src={b.imageUrl} alt={b.title} className="h-full w-full object-cover" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex max-w-lg flex-col gap-2 p-5 sm:p-8">
        <h2
          className="font-display text-xl font-bold leading-tight text-white sm:text-3xl"
          style={{ textShadow: bannerTextShadow }}
        >
          {b.title}
        </h2>
        {b.subtitle && (
          <p className="text-sm font-medium text-white" style={{ textShadow: bannerTextShadow }}>
            {b.subtitle}
          </p>
        )}
      </div>
    </div>
  );

  return (
    <section className="mx-auto max-w-7xl px-4 pt-14 sm:px-6" aria-label="Banners promocionais">
      <div className="relative">
        {b.linkUrl ? <a href={b.linkUrl} className="block">{content}</a> : content}

        {banners.length > 1 && (
          <>
            <button
              type="button"
              onClick={() => setIndex((i) => (i - 1 + banners.length) % banners.length)}
              aria-label="Banner anterior"
              className="absolute left-2 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-ink shadow-md transition-colors hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink sm:left-4"
            >
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
                <path d="m15 18-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => setIndex((i) => (i + 1) % banners.length)}
              aria-label="Próximo banner"
              className="absolute right-2 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-ink shadow-md transition-colors hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink sm:right-4"
            >
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
                <path d="m9 18 6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </>
        )}
      </div>

      {banners.length > 1 && (
        <div className="mt-3 flex justify-center gap-2">
          {banners.map((x, i) => (
            <button
              key={x.id}
              type="button"
              onClick={() => setIndex(i)}
              aria-label={`Ir para o banner ${i + 1}`}
              aria-current={i === index % banners.length ? "true" : undefined}
              className={`h-2 rounded-full transition-all ${
                i === index % banners.length ? "w-6 bg-ink" : "w-2 bg-ink/25"
              }`}
            />
          ))}
        </div>
      )}
    </section>
  );
}
