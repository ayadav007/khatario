'use client';

import { useEffect, useState } from 'react';
import clsx from 'clsx';
import type { StoreHeroSlide } from '@/lib/store/store-theme';

/** Khatario pack hero. Studio and Premium Grocery render their own heroes. */
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
  paper?: string;
}) {
  const [index, setIndex] = useState(0);
  const count = slides.length;

  useEffect(() => {
    if (count <= 1) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const t = window.setInterval(() => {
      setIndex((i) => (i + 1) % count);
    }, 9000);
    return () => window.clearInterval(t);
  }, [count]);

  useEffect(() => {
    if (count === 0) return;
    if (index >= count) setIndex(0);
  }, [count, index]);

  if (count === 0) return null;

  return (
    <section className={clsx(compact ? 'mt-1' : 'store-khatario-hero mt-0')}>
      <div className="relative aspect-[16/9] w-full overflow-hidden rounded-[0.85rem] bg-black/20 sm:aspect-[21/9] sm:rounded-none lg:h-[min(52vh,28rem)] lg:aspect-auto">
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
              <div className="h-full w-full" style={{ backgroundColor: accent }} />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/15 to-transparent" />
            <div className={clsx('absolute inset-x-0 bottom-0 p-3 sm:p-6 lg:p-8', count > 1 && 'pb-6 sm:pb-10')}>
              {s.title ? (
                <p className="line-clamp-2 text-[15px] font-semibold leading-snug text-white sm:text-2xl lg:text-3xl">{s.title}</p>
              ) : null}
              {s.subtitle ? (
                <p className="mt-0.5 line-clamp-2 text-[11px] text-white/80 sm:mt-1 sm:max-w-xl sm:text-sm">{s.subtitle}</p>
              ) : null}
              {ctaLabel && !compact ? (
                <button
                  type="button"
                  className="mt-2 min-h-8 rounded-full bg-white px-3 text-[12px] font-semibold sm:mt-4 sm:min-h-10 sm:px-5 sm:text-sm"
                  style={{ color: accent }}
                  onClick={onCta}
                >
                  {ctaLabel}
                </button>
              ) : null}
            </div>
          </div>
        ))}
        {count > 1 ? (
          <div className="absolute bottom-2 left-0 right-0 z-10 flex justify-center gap-1.5 sm:bottom-3">
            {slides.map((_, i) => (
              <button
                key={i}
                type="button"
                aria-label={`Slide ${i + 1}`}
                onClick={() => setIndex(i)}
                className="h-1.5 rounded-full"
                style={{
                  width: i === index ? 16 : 6,
                  backgroundColor: i === index ? '#fff' : 'rgba(255,255,255,0.45)',
                }}
              />
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}
