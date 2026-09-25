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
}: {
  slides: StoreHeroSlide[];
  ctaLabel: string;
  accent: string;
  onCta?: () => void;
  compact?: boolean;
  variant?: 'classic' | 'chowk';
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
    if (index >= count) setIndex(0);
  }, [count, index]);

  if (count === 0) return null;
  const slide = slides[Math.min(index, count - 1)];

  if (variant === 'chowk') {
    const panel = paper || '#f3eee6';
    const ink = chowkInkOn(panel);
    const idx = String(index + 1).padStart(2, '0');
    const total = String(count).padStart(2, '0');
    const hasPhoto = slides.some((s) => s.image_url);
    return (
      <section className={compact ? 'mb-2' : 'mb-0'}>
        <div className={clsx('mx-auto flex w-full max-w-[90rem] flex-col', hasPhoto && 'md:flex-row md:min-h-[480px]')}>
          {hasPhoto ? (
          <div
            className={`relative w-full overflow-hidden md:w-[58%] ${
              compact ? 'h-28' : 'h-[52vw] max-h-[280px] md:max-h-none md:h-auto md:min-h-[480px]'
            }`}
          >
            {slides.map((s, i) => (
              <div
                key={`${s.image_url}-${i}`}
                className="chowk-hero-slide absolute inset-0 transition-opacity duration-700"
                style={{ opacity: i === index ? 1 : 0 }}
                aria-hidden={i !== index}
              >
                {s.image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={s.image_url} alt="" className="h-full w-full object-cover object-[center_40%]" />
                ) : (
                  <div className="h-full w-full" style={{ backgroundColor: panel }} />
                )}
              </div>
            ))}
          </div>
          ) : null}
          <div
            className={`relative z-[1] w-full ${hasPhoto ? 'md:flex md:w-[42%] md:flex-col md:justify-end' : ''} ${
              compact
                ? 'px-3 py-2'
                : hasPhoto
                  ? '-mt-9 mx-4 mb-1 px-4 pb-6 pt-5 md:mx-0 md:mb-0 md:mt-0 md:px-10 md:py-14 lg:px-12'
                  : 'px-4 py-8 md:mx-auto md:max-w-3xl md:px-8 md:py-16'
            }`}
            style={{ backgroundColor: panel }}
          >
            {slide.title ? (
              <h1
                className={`font-chowk-display line-clamp-3 tracking-tight ${
                  compact
                    ? 'text-xl leading-none'
                    : 'text-[clamp(1.75rem,7vw,3.35rem)] leading-[0.94]'
                }`}
                style={{ color: ink }}
                aria-live="polite"
              >
                {slide.title}
              </h1>
            ) : null}
            {slide.subtitle ? (
              <p
                className={`line-clamp-3 max-w-sm ${compact ? 'mt-1 text-[10px]' : 'mt-4 text-[13px] leading-[1.55]'}`}
                style={{ color: ink, opacity: 0.55 }}
              >
                {slide.subtitle}
              </p>
            ) : null}
            {ctaLabel && !compact ? (
              <button
                type="button"
                className="mt-5 min-h-11 max-w-full text-left text-[13px]"
                style={{ color: ink }}
                onClick={onCta}
              >
                <span className="inline-block max-w-full truncate border-b pb-px" style={{ borderColor: ink }}>
                  {ctaLabel}
                </span>
                <span aria-hidden className="ml-1.5 opacity-60">
                  →
                </span>
              </button>
            ) : null}
            {count > 1 ? (
              <button
                type="button"
                onClick={() => setIndex((i) => (i + 1) % count)}
                aria-label={`Next slide, ${index + 1} of ${count}`}
                className={`tabular-nums tracking-[0.14em] ${compact ? 'mt-2 text-[9px]' : 'mt-8 min-h-11 text-left text-[11px]'}`}
                style={{ color: ink, opacity: 0.4 }}
              >
                {idx} / {total}
              </button>
            ) : null}
          </div>
        </div>
      </section>
    );
  }

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
