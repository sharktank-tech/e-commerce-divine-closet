"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
  images: string[];
  name: string;
  className?: string;
  intervalMs?: number;
};

// Galeria que alterna as imagens enquanto o mouse está em cima.
// Sem imagens: mostra o placeholder da marca.
export function ProductSlideshow({ images, name, className, intervalMs = 1200 }: Props) {
  const [index, setIndex] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

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

  useEffect(() => {
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, []);

  if (images.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-primary-400">
        <span className="font-display text-6xl">DC</span>
      </div>
    );
  }

  return (
    <div
      className="relative h-full w-full overflow-hidden"
      onMouseEnter={start}
      onMouseLeave={stop}
    >
      {images.map((src, i) => (
        <img
          key={`${src}-${i}`}
          src={src}
          alt={i === 0 ? name : ""}
          aria-hidden={i !== 0}
          loading={i === 0 ? undefined : "lazy"}
          className={`absolute inset-0 h-full w-full object-cover transition-transform duration-700 ease-in-out ${
            className || ""
          }`}
          style={{ transform: `translateX(${(i - index) * 100}%)` }}
        />
      ))}
      {images.length > 1 && (
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
    </div>
  );
}
