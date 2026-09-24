'use client';

import { useEffect, useState } from 'react';
import type { StoreHeroSlide } from '@/lib/store/store-theme';

export function StoreHeroCarousel({
  slides,
  ctaLabel,
  accent,
  onCta,
  compact = false,
}: {
  slides: StoreHeroSlide[];
  ctaLabel: string;
  accent: string;
  onCta?: () => void;
  compact?: boolean;
}) {
  const [index, setIndex] = useState(0);
  const count = slides.length;

  useEffect(() => {
    if (count <= 1) return;
    const t = window.setInterval(() => {
      setIndex((i) => (i + 1) % count);
    }, 4500);
    return () => window.clearInterval(t);
  }, [count]);

  useEffect(() => {
    if (index >= count) setIndex(0);
  }, [count, index]);

  if (count === 0) return null;
  const slide = slides[Math.min(index, count - 1)];

  return (
    <section className={`relative overflow-hidden rounded-2xl bg-gray-900 ${compact ? 'mb-2' : 'mb-5'}`}>
      <div className={compact ? 'relative h-28' : 'relative h-52 sm:h-64 md:h-72'}>
        {slides.map((s, i) => (
          <div
            key={`${s.image_url}-${i}`}
            className="absolute inset-0 transition-opacity duration-500"
            style={{ opacity: i === index ? 1 : 0 }}
            aria-hidden={i !== index}
          >
            {s.image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={s.image_url} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="h-full w-full bg-gray-800" />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/25 to-black/10" />
          </div>
        ))}
        <div
          className={`relative z-10 flex h-full flex-col justify-end ${
            compact ? 'px-3' : 'px-5 md:px-8'
          } ${count > 1 ? (compact ? 'pb-5' : 'pb-8') : compact ? 'pb-3' : 'pb-5 md:pb-6'}`}
        >
          {slide.title ? (
            <p className={compact ? 'text-[12px] font-semibold text-white' : 'text-xl font-semibold text-white md:text-3xl'}>
              {slide.title}
            </p>
          ) : null}
          {slide.subtitle ? (
            <p className={compact ? 'mt-0.5 text-[9px] text-white/80' : 'mt-1 max-w-lg text-sm text-white/85'}>
              {slide.subtitle}
            </p>
          ) : null}
          {ctaLabel && !compact ? (
            <button
              type="button"
              className="mt-3 w-fit rounded-full px-5 py-2 text-sm font-semibold text-white"
              style={{ backgroundColor: accent }}
              onClick={onCta}
            >
              {ctaLabel}
            </button>
          ) : null}
        </div>
      </div>
      {count > 1 ? (
        <div className="absolute bottom-2 left-0 right-0 z-10 flex justify-center gap-1.5">
          {slides.map((_, i) => (
            <button
              key={i}
              type="button"
              aria-label={`Slide ${i + 1}`}
              className={`h-1.5 rounded-full transition-all ${i === index ? 'w-5 bg-white' : 'w-1.5 bg-white/50'}`}
              onClick={() => setIndex(i)}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}
