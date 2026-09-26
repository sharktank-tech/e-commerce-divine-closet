"use client";

import { useEffect, useState } from "react";

type Banner = {
  id: string;
  title: string;
  subtitle?: string | null;
  imageUrl: string;
  linkUrl?: string | null;
};

export function BannerCarousel({ banners }: { banners: Banner[] }) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (banners.length <= 1) return;
    const t = setInterval(() => setIndex((i) => (i + 1) % banners.length), 5000);
    return () => clearInterval(t);
  }, [banners.length]);

  if (banners.length === 0) return null;
  const b = banners[index];

  const content = (
    <div className="relative aspect-[16/6] w-full overflow-hidden rounded-2xl bg-primary-100">
      <img src={b.imageUrl} alt={b.title} className="h-full w-full object-cover" />
      <div className="absolute inset-0 bg-gradient-to-r from-ink/60 via-ink/20 to-transparent" />
      <div className="absolute inset-y-0 left-0 flex max-w-md flex-col justify-center gap-2 p-8">
        <h2 className="font-display text-2xl font-bold text-white sm:text-3xl">{b.title}</h2>
        {b.subtitle && <p className="text-sm text-white/90">{b.subtitle}</p>}
      </div>
    </div>
  );

  return (
    <section className="mx-auto max-w-7xl px-4 pt-14 sm:px-6">
      {b.linkUrl ? (
        <a href={b.linkUrl}>{content}</a>
      ) : (
        content
      )}
      {banners.length > 1 && (
        <div className="mt-3 flex justify-center gap-2">
          {banners.map((x, i) => (
            <button
              key={x.id}
              onClick={() => setIndex(i)}
              aria-label={`Banner ${i + 1}`}
              className={`h-2 rounded-full transition-all ${
                i === index ? "w-6 bg-ink" : "w-2 bg-ink/25"
              }`}
            />
          ))}
        </div>
      )}
    </section>
  );
}
