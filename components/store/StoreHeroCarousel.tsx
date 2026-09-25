'use client';

import { useEffect, useState } from 'react';
import clsx from 'clsx';
import type { StoreHeroSlide } from '@/lib/store/store-theme';
import { chowkInkOn } from '@/lib/store/store-theme';

export function StoreHeroCarousel({
  slides,
  ctaLabel,
  accent,
  onCta,
  compact = false,
  variant = 'classic',
  paper,
  flush = false,
}: {
  slides: StoreHeroSlide[];
  ctaLabel: string;
  accent: string;
  onCta?: () => void;
  compact?: boolean;
  variant?: 'classic' | 'chowk' | 'atelier';
  paper?: string;
  flush?: boolean;
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
    if (index >= count) setIndex(0);
  }, [count, index]);

  if (count === 0) return null;
  const slide = slides[Math.min(index, count - 1)];

  if (variant === 'atelier') {
    const panel = paper || '#f6f3ef';
    return (
      <section className={compact ? 'mb-2 px-3' : 'mx-auto max-w-6xl px-4 pt-3'}>
        <div className="relative aspect-[4/3] w-full overflow-hidden rounded-[1.75rem]">
          {slides.map((s, i) => (
            <div
              key={`${s.image_url}-${i}`}
              className="atelier-hero-slide absolute inset-0 transition-opacity duration-700"
              style={{ opacity: i === index ? 1 : 0 }}
              aria-hidden={i !== index}
            >
              {s.image_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={s.image_url} alt="" className="h-full w-full object-cover object-center" />
              ) : (
                <div className="h-full w-full" style={{ backgroundColor: panel }} />
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/20 to-transparent" />
            </div>
          ))}
          <div
            className={clsx(
              'relative z-10 flex h-full min-h-0 flex-col justify-end',
              compact ? 'px-3 pb-3' : 'px-4 pb-4 sm:px-6 sm:pb-5',
            )}
          >
            {slide.title ? (
              <h1
                className={`font-atelier-display line-clamp-3 text-white ${
                  compact ? 'text-base leading-tight' : 'text-[clamp(1.35rem,5.2vw,2.35rem)] leading-[1.12]'
                }`}
                aria-live="polite"
              >
                {slide.title}
              </h1>
            ) : null}
            {slide.subtitle ? (
              <p
                className={`line-clamp-2 max-w-sm text-white/80 ${compact ? 'mt-0.5 text-[9px]' : 'mt-1.5 text-[13px] leading-snug'}`}
              >
                {slide.subtitle}
              </p>
            ) : null}
            {ctaLabel && !compact ? (
              <button
                type="button"
                className="mt-3 min-h-10 w-fit shrink-0 rounded-full bg-white px-4 text-[13px] font-medium text-[#171412]"
                onClick={onCta}
              >
                {ctaLabel} →
              </button>
            ) : null}
          </div>
        </div>
      </section>
    );
  }

  if (variant === 'chowk') {
    const panel = paper || '#f7f1e8';
    const ink = chowkInkOn(panel);
    const idx = String(index + 1).padStart(2, '0');
    const total = String(count).padStart(2, '0');
    const hasPhoto = Boolean(slide.image_url);
    return (
      <section className={compact ? 'mb-2 px-3' : 'mx-auto max-w-6xl px-4 pt-3 md:pt-5'}>
        <div
          className={clsx(
            'overflow-hidden rounded-[1.75rem] bg-white shadow-sm',
            compact ? '' : 'md:grid md:min-h-[340px] md:grid-cols-2',
          )}
        >
          <div className={clsx('relative flex flex-col justify-center', compact ? 'px-4 py-4' : 'px-5 py-6 md:px-10 md:py-12')}>
            {slide.title ? (
              <h1
                className={`font-chowk-display mt-2 line-clamp-4 tracking-tight ${
                  compact ? 'text-xl leading-none' : 'text-[clamp(1.85rem,5vw,3.4rem)] leading-[1.02]'
                }`}
                style={{ color: ink }}
                aria-live="polite"
              >
                {slide.title}
              </h1>
            ) : null}
            {slide.subtitle ? (
              <p className={`line-clamp-3 max-w-md ${compact ? 'mt-1 text-[10px]' : 'mt-3 text-[13px] leading-relaxed'}`} style={{ color: ink, opacity: 0.62 }}>
                {slide.subtitle}
              </p>
            ) : null}
            {ctaLabel && !compact ? (
              <button
                type="button"
                className="mt-5 min-h-11 w-fit rounded-full px-5 text-[13px] font-semibold"
                style={{ backgroundColor: accent, color: '#fff7ed' }}
                onClick={onCta}
              >
                {ctaLabel} →
              </button>
            ) : null}
            {count > 1 ? (
              <button
                type="button"
                onClick={() => setIndex((i) => (i + 1) % count)}
                aria-label={`Next slide, ${index + 1} of ${count}`}
                className={`tabular-nums ${compact ? 'mt-2 text-[9px]' : 'mt-6 min-h-11 text-left text-[12px] font-medium'}`}
                style={{ color: ink, opacity: 0.4 }}
              >
                {idx} / {total}
              </button>
            ) : null}
          </div>
          {hasPhoto || slides.some((s) => s.image_url) ? (
            <div className={clsx('relative overflow-hidden', compact ? 'h-28' : 'h-52 md:h-auto')}>
              {slides.map((s, i) => (
                <div
                  key={`${s.image_url}-${i}`}
                  className="chowk-hero-slide absolute inset-0 transition-opacity duration-700"
                  style={{ opacity: i === index ? 1 : 0 }}
                  aria-hidden={i !== index}
                >
                  {s.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={s.image_url} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="h-full w-full" style={{ backgroundColor: panel }} />
                  )}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </section>
    );
  }

  return (
    <section className={`relative overflow-hidden rounded-2xl bg-gray-900 ${compact || flush ? 'mb-0' : 'mb-5'}`}>
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
