'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { X, ExternalLink, ArrowRight, ChevronLeft, ChevronRight, Monitor } from 'lucide-react';

function linesToUrls(text: string): string[] {
  if (!text?.trim()) return [];
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

export type PromotionFormPreviewInput = {
  message_type: 'banner' | 'carousel' | 'modal' | 'sidebar' | 'topbar';
  title: string;
  description?: string;
  image_url?: string;
  button_text?: string;
  button_url?: string;
  button_action?: string;
  background_color: string;
  text_color: string;
  dismissible?: boolean;
  topbar_mode?: 'single' | 'vertical_carousel';
  topbar_image_urls_lines?: string;
  carousel_image_urls_lines?: string;
  carousel_advance_ms?: number;
};

function CtaIcon({ action }: { action?: string }) {
  if (action === 'link') return <ExternalLink className="w-3 h-3" />;
  return <ArrowRight className="w-3 h-3" />;
}

export function PromotionFormPreview({ form }: { form: PromotionFormPreviewInput }) {
  const bg = form.background_color || '#3b82f6';
  const tc = form.text_color || '#ffffff';
  const title = (form.title || '').trim() || 'Your promotion title';
  const desc = (form.description || '').trim();
  const buttonText = (form.button_text || '').trim();
  const action = form.button_action || 'link';

  const topbarLineUrls = useMemo(
    () => linesToUrls(form.topbar_image_urls_lines || ''),
    [form.topbar_image_urls_lines]
  );
  const topbarUrls = useMemo(() => {
    if (form.message_type !== 'topbar') return [];
    if (topbarLineUrls.length) return topbarLineUrls;
    if (form.image_url?.trim()) return [form.image_url.trim()];
    return [];
  }, [form.message_type, topbarLineUrls, form.image_url]);

  const carouselLineUrls = useMemo(
    () => linesToUrls(form.carousel_image_urls_lines || ''),
    [form.carousel_image_urls_lines]
  );
  const carouselUrls = useMemo(() => {
    if (form.message_type !== 'carousel') return [];
    if (carouselLineUrls.length) return carouselLineUrls;
    if (form.image_url?.trim()) return [form.image_url.trim()];
    return [];
  }, [form.message_type, carouselLineUrls, form.image_url]);

  const [carouselIdx, setCarouselIdx] = useState(0);
  const [topbarIdx, setTopbarIdx] = useState(0);
  const carouselLen = carouselUrls.length;
  const topbarLen = topbarUrls.length;
  const safeCarousel = carouselLen ? carouselIdx % carouselLen : 0;
  const safeTopbar = topbarLen ? topbarIdx % topbarLen : 0;

  useEffect(() => {
    setCarouselIdx(0);
  }, [form.message_type, carouselLineUrls.join('\n'), form.image_url]);

  useEffect(() => {
    setTopbarIdx(0);
  }, [form.message_type, topbarLineUrls.join('\n'), form.image_url, form.topbar_mode]);

  const modalImage = (form.image_url || '').trim();

  if (form.message_type === 'banner') {
    return (
      <div
        className="rounded-2xl border border-gray-200 overflow-hidden pointer-events-none select-none shadow-sm"
        style={{ backgroundColor: bg, color: tc }}
        aria-hidden
      >
        <div className="max-w-[1600px] mx-auto px-3 py-2 md:py-2">
          <div className="flex flex-col md:flex-row items-center justify-center gap-2 md:gap-4 text-center md:text-left">
            <div className="flex-1 min-w-0">
              <span className="font-bold text-xs md:text-sm">{title}</span>
              {desc && <span className="hidden md:inline ml-2 opacity-90 text-xs md:text-sm">{desc}</span>}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {buttonText && (
                <span
                  className="px-3 py-1 bg-white text-gray-900 rounded-full text-xs font-bold flex items-center gap-1 shadow-sm"
                  style={{ color: bg }}
                >
                  {buttonText}
                  <CtaIcon action={action} />
                </span>
              )}
              {form.dismissible !== false && (
                <span className="p-1 rounded-full opacity-80">
                  <X className="w-3.5 h-3.5" />
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (form.message_type === 'carousel') {
    const showImg = carouselUrls[safeCarousel];
    return (
      <div
        className="rounded-2xl border border-border overflow-hidden bg-surface pointer-events-none select-none"
        aria-hidden
      >
        <div
          className="flex h-36 sm:h-44 items-center px-4 sm:px-6 relative"
          style={{ backgroundColor: bg }}
        >
          <div className="flex-1 z-10 space-y-1 min-w-0 max-w-[58%] pr-2">
            <h3 className="text-sm sm:text-lg font-black leading-tight" style={{ color: tc }}>
              {title}
            </h3>
            {desc && (
              <p className="text-xs opacity-90 line-clamp-2" style={{ color: tc }}>
                {desc}
              </p>
            )}
            {buttonText && (
              <span
                className="inline-flex mt-1 px-3 py-1.5 bg-white text-gray-900 rounded-lg text-xs font-bold items-center gap-1"
                style={{ color: bg }}
              >
                {buttonText}
                <CtaIcon action={action} />
              </span>
            )}
          </div>
          <div className="absolute right-0 top-0 bottom-0 w-[42%] flex items-center justify-center p-2">
            {showImg ? (
              <img
                key={showImg}
                src={showImg}
                alt=""
                className="max-h-full object-contain drop-shadow-lg"
              />
            ) : (
              <div className="w-full h-2/3 rounded-full bg-white/10 flex items-center justify-center text-[10px] text-white/60 text-center px-1">
                No art
              </div>
            )}
          </div>
        </div>
        {carouselLen > 1 && (
          <div className="flex justify-center gap-2 py-1.5 bg-black/5 pointer-events-auto">
            <button
              type="button"
              className="p-1 rounded bg-black/10 hover:bg-black/20 text-gray-800"
              onClick={() => setCarouselIdx((i) => (i - 1 + carouselLen) % carouselLen)}
              aria-label="Previous preview slide"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-[10px] text-gray-500 self-center">
              {safeCarousel + 1} / {carouselLen}
            </span>
            <button
              type="button"
              className="p-1 rounded bg-black/10 hover:bg-black/20 text-gray-800"
              onClick={() => setCarouselIdx((i) => (i + 1) % carouselLen)}
              aria-label="Next preview slide"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}
        {carouselLen <= 1 && (
          <p className="text-[10px] text-center text-gray-500 py-1 px-2 bg-gray-50 border-t border-gray-100">
            Add a second image URL to preview multiple slides. Single slide: dashboard carousel.
          </p>
        )}
      </div>
    );
  }

  if (form.message_type === 'modal') {
    return (
      <div
        className="relative rounded-2xl border border-gray-200 bg-white overflow-hidden shadow-lg pointer-events-none select-none"
        aria-hidden
      >
        {modalImage ? (
          <div className="relative h-36 w-full">
            <img src={modalImage} alt="" className="w-full h-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
            <h3 className="absolute bottom-3 left-3 right-3 text-base font-black text-white leading-tight">
              {title}
            </h3>
          </div>
        ) : (
          <div className="p-4 pb-2" style={{ backgroundColor: bg }}>
            <h3 className="text-lg font-black text-white leading-tight">{title}</h3>
          </div>
        )}
        <div className="p-4 pt-3 space-y-3">
          {desc && <p className="text-sm text-gray-600 line-clamp-3">{desc}</p>}
          {buttonText && (
            <div
              className="w-full py-2.5 rounded-xl font-bold text-sm flex items-center justify-center gap-2"
              style={{ backgroundColor: bg, color: tc }}
            >
              {buttonText}
              <CtaIcon action={action} />
            </div>
          )}
        </div>
      </div>
    );
  }

  if (form.message_type === 'sidebar') {
    return (
      <div className="max-w-xs pointer-events-none select-none" aria-hidden>
        <div
          className="relative p-3 rounded-2xl overflow-hidden shadow-md"
          style={{ backgroundColor: bg, color: tc }}
        >
          <div className="absolute top-0 right-0 -mr-6 -mt-6 w-16 h-16 bg-white opacity-10 rounded-full blur-2xl" />
          <div className="relative space-y-2">
            <div className="flex items-start justify-between gap-1">
              <h4 className="font-black text-xs uppercase tracking-wider leading-tight">{title}</h4>
              {form.dismissible !== false && <X className="w-3 h-3 opacity-60 shrink-0" />}
            </div>
            {desc && <p className="text-[10px] font-medium opacity-90 line-clamp-2">{desc}</p>}
            {buttonText && (
              <div className="flex items-center gap-1 text-[9px] font-black uppercase tracking-widest pt-0.5">
                {buttonText}
                <CtaIcon action={action} />
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (form.message_type === 'topbar') {
    const useCarousel = form.topbar_mode === 'vertical_carousel' && topbarLen >= 2;
    return (
      <div className="space-y-2 pointer-events-none select-none" aria-hidden>
        <div className="flex items-center gap-2 text-xs text-gray-600">
          <Monitor className="w-4 h-4" />
          <span>App header (desktop) — center strip</span>
        </div>
        <div className="rounded-lg border-2 border-dashed border-gray-300 bg-gray-100 p-1">
          <div className="h-10 bg-white rounded border border-gray-200 overflow-hidden">
            {topbarLen === 0 ? (
              <div className="h-full flex items-center justify-center text-[10px] text-gray-400">
                Add image URL(s) to preview
              </div>
            ) : useCarousel ? (
              <div
                className="h-full w-full min-w-0 overflow-hidden pointer-events-auto"
                style={{ maxHeight: '2.5rem' }}
              >
                <div
                  className="flex flex-col transition-transform duration-500 ease-in-out will-change-transform"
                  style={{
                    height: `${topbarLen * 2.5}rem`,
                    transform: `translateY(-${safeTopbar * 2.5}rem)`,
                  }}
                >
                  {topbarUrls.map((src, i) => (
                    <div key={`${src}-${i}`} className="h-10 w-full shrink-0">
                      <img
                        src={src}
                        alt=""
                        className="h-full w-full min-h-0 min-w-0 object-cover object-center"
                        draggable={false}
                      />
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <img
                src={topbarUrls[0]}
                alt=""
                className="h-full w-full min-h-0 min-w-0 object-cover object-center"
                draggable={false}
              />
            )}
          </div>
        </div>
        {topbarLen > 1 && useCarousel && (
          <div className="flex items-center justify-center gap-2 pointer-events-auto text-[10px] text-gray-600">
            <button
              type="button"
              className="p-0.5 rounded border border-gray-200 bg-white hover:bg-gray-50"
              onClick={() => setTopbarIdx((i) => (i - 1 + topbarLen) % topbarLen)}
              aria-label="Previous topbar image"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <span>
              {safeTopbar + 1} / {topbarLen} — vertical steps in the live app
            </span>
            <button
              type="button"
              className="p-0.5 rounded border border-gray-200 bg-white hover:bg-gray-50"
              onClick={() => setTopbarIdx((i) => (i + 1) % topbarLen)}
              aria-label="Next topbar image"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
        {topbarLen > 1 && !useCarousel && (
          <p className="text-[10px] text-gray-500 text-center">First image only (single mode). Enable vertical carousel for 2+ URLs.</p>
        )}
      </div>
    );
  }

  return null;
}

export function promotionPreviewLabel(type: PromotionFormPreviewInput['message_type']): string {
  switch (type) {
    case 'banner':
      return 'Top of main content (full-width strip)';
    case 'carousel':
      return 'Dashboard — large card on the home area';
    case 'modal':
      return 'Centered popup over the app';
    case 'sidebar':
      return 'Left navigation panel (expanded)';
    case 'topbar':
      return 'App header image strip (desktop)';
    default:
      return 'Preview';
  }
}
