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
  variant?: 'classic' | 'chowk' | 'atelier' | 'khatario' | 'aether';
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
    if (count === 0) return;
    if (index >= count) setIndex(0);
  }, [count, index]);

  if (count === 0) return null;
  const slide = slides[Math.min(index, count - 1)];

  if (variant === 'aether') {
    return (
      <section
        className={clsx(
          'relative isolate overflow-hidden bg-[#0c0b09]',
          compact ? 'h-48' : 'min-h-[88svh]',
        )}
      >
        {slides.map((s, i) => (
          <div
            key={`${s.image_url}-${i}`}
            className="absolute inset-0 transition-opacity duration-1000"
            style={{ opacity: i === index ? 1 : 0 }}
            aria-hidden={i !== index}
          >
            {s.image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={s.image_url}
                alt=""
                className={clsx(
                  'h-full w-full object-cover',
                  i === index && 'store-aether-kenburns',
                )}
              />
            ) : (
              <div className="h-full w-full" style={{ backgroundColor: accent }} />
            )}
          </div>
        ))}
        <div className="absolute inset-0 bg-gradient-to-t from-[#0c0b09] via-[#0c0b09]/50 to-[#0c0b09]/20" />
        <div
          className={clsx(
            'relative z-10 flex flex-col justify-end',
            compact ? 'h-48 px-4 pb-4' : 'min-h-[88svh] px-5 pb-16 pt-28 md:px-10 md:pb-24',
          )}
        >
          <p
            className={clsx(
              'uppercase tracking-[0.42em] text-[#c4a46a]',
              compact ? 'text-[8px]' : 'text-[11px]',
            )}
          >
            {count > 1 ? `${String(index + 1).padStart(2, '0')}  /  ${String(count).padStart(2, '0')}` : 'Lookbook'}
          </p>
          {slide.title ? (
            <h1
              className={clsx(
                'font-noir-display mt-3 max-w-4xl leading-[0.92] text-[#f6f1e8]',
                compact ? 'text-2xl' : 'text-[16vw] md:text-[7rem]',
              )}
              aria-live="polite"
            >
              {slide.title}
            </h1>
          ) : null}
          {slide.subtitle ? (
            <p
              className={clsx(
                'max-w-md leading-relaxed text-[#f6f1e8]/75',
                compact ? 'mt-1 line-clamp-2 text-[9px]' : 'mt-6 text-sm md:text-base md:leading-7',
              )}
            >
              {slide.subtitle}
            </p>
          ) : null}
          {ctaLabel && !compact ? (
            <button
              type="button"
              className="store-aether-shine mt-8 min-h-11 w-fit px-6 text-[12px] font-medium uppercase tracking-[0.22em] text-[#0c0b09]"
              style={{ backgroundColor: accent }}
              onClick={onCta}
            >
              {ctaLabel}
            </button>
          ) : null}
          {!compact ? (
            <p className="mt-14 flex items-center gap-3 text-[10px] uppercase tracking-[0.3em] text-[#f6f1e8]/45">
              <span className="block h-12 w-px bg-[#c4a46a]" />
              Scroll
            </p>
          ) : null}
        </div>
        {count > 1 ? (
          <div className="absolute bottom-4 left-0 right-0 z-10 flex justify-center gap-1.5">
            {slides.map((_, i) => (
              <button
                key={i}
                type="button"
                aria-label={`Slide ${i + 1}`}
                onClick={() => setIndex(i)}
                className="h-1 rounded-full transition-all"
                style={{
                  width: i === index ? 22 : 6,
                  backgroundColor: i === index ? accent : 'rgba(246,241,232,0.35)',
                }}
              />
            ))}
          </div>
        ) : null}
      </section>
    );
  }

  if (variant === 'khatario') {
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
