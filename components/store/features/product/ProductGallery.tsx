'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, ImageIcon, Play, X } from 'lucide-react';
import clsx from 'clsx';
import { videoEmbed, type VideoEmbed } from '@/lib/store/product-extras';
import {
  DOUBLE_TAP_ZOOM,
  clampPan,
  clampScale,
  isDoubleTap,
  stepIndex,
  swipeDirection,
  zoomAt,
  type Tap,
} from './product-logic';
import { useMounted, useOverlay } from './useOverlay';

type Slide = { kind: 'image'; src: string } | VideoEmbed;

type Props = {
  images: string[];
  videoUrl?: string | null;
  alt: string;
  /** 'side' puts thumbnails in a column on the left from 1024 px; default is below. */
  thumbs?: 'side' | 'bottom';
};

const HOVER_ZOOM = '(hover: hover) and (pointer: fine) and (min-width: 1024px)';
const cssUrl = (src: string) => `url("${src.replace(/["\\\n]/g, encodeURIComponent)}")`;

/** Product photos (and an optional video, always last) with swipe, hover zoom and a lightbox. */
export function ProductGallery({ images, videoUrl, alt, thumbs = 'bottom' }: Props) {
  const pics = useMemo(() => images.filter(Boolean), [images]);
  const video = useMemo(() => videoEmbed(videoUrl), [videoUrl]);
  const slides: Slide[] = useMemo(
    () => [...pics.map((src) => ({ kind: 'image' as const, src })), ...(video ? [video] : [])],
    [pics, video],
  );
  const [index, setIndex] = useState(0);
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [zoomAtPos, setZoomAtPos] = useState<string | null>(null);
  const start = useRef<{ id: number; x: number; y: number } | null>(null);
  const swiped = useRef(false);
  const side = thumbs === 'side';

  const firstKey = slides[0]?.src ?? '';
  useEffect(() => {
    setIndex(0);
  }, [firstKey]);

  const count = slides.length;
  const at = Math.min(index, Math.max(0, count - 1));
  const current = slides[at];

  const go = useCallback(
    (step: number) => {
      setZoomAtPos(null);
      setIndex((i) => stepIndex(Math.min(i, count - 1), step, count));
    },
    [count],
  );

  if (!current) {
    return (
      <div className="flex aspect-square max-h-[70vh] w-full flex-col items-center justify-center gap-2 bg-gray-50 text-gray-400">
        <ImageIcon className="h-10 w-10" aria-hidden />
        <span className="text-sm">No photo</span>
      </div>
    );
  }

  const isImage = current.kind === 'image';
  const label = (s: Slide, i: number) => (s.kind === 'image' ? `Photo ${i + 1}` : 'Video');

  const onMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isImage || !window.matchMedia(HOVER_ZOOM).matches) return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = Math.min(100, Math.max(0, ((e.clientX - r.left) / r.width) * 100));
    const y = Math.min(100, Math.max(0, ((e.clientY - r.top) / r.height) * 100));
    setZoomAtPos(`${x}% ${y}%`);
  };

  return (
    <div className={clsx('flex flex-col gap-2', side && 'lg:flex-row-reverse lg:items-start')}>
      <div className="min-w-0 flex-1">
        <div
          role="group"
          aria-roledescription="carousel"
          aria-label={`${alt} photos`}
          tabIndex={0}
          className={clsx(
            'group relative aspect-square max-h-[70vh] w-full select-none overflow-hidden bg-gray-50 outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]',
            isImage && 'cursor-zoom-in',
          )}
          style={{ touchAction: 'pan-y' }}
          onPointerDown={(e) => {
            // Video controls (seek bar scrubbing) must not flip the slide; dots, thumbs and arrows leave it.
            if (e.pointerType === 'mouse' || !isImage) return;
            if ((e.target as Element).closest?.('video, iframe')) return;
            start.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
            swiped.current = false;
          }}
          onPointerUp={(e) => {
            const s = start.current;
            start.current = null;
            if (!s || s.id !== e.pointerId) return;
            const dir = swipeDirection(e.clientX - s.x, e.clientY - s.y);
            if (dir !== 0 && count > 1) {
              swiped.current = true;
              go(dir);
            }
          }}
          onPointerCancel={() => {
            start.current = null;
          }}
          onMouseMove={onMouseMove}
          onMouseLeave={() => setZoomAtPos(null)}
          onClick={() => {
            if (swiped.current) {
              swiped.current = false;
              return;
            }
            if (isImage) setLightbox(at);
          }}
          onKeyDown={(e) => {
            if (e.target !== e.currentTarget) return;
            if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
              e.preventDefault();
              go(e.key === 'ArrowRight' ? 1 : -1);
            } else if ((e.key === 'Enter' || e.key === ' ') && isImage) {
              e.preventDefault();
              setLightbox(at);
            }
          }}
        >
          {current.kind === 'image' ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={current.src}
                alt={count > 1 ? `${alt} – photo ${at + 1}` : alt}
                draggable={false}
                className="h-full w-full object-contain"
              />
              {zoomAtPos ? (
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-0 bg-gray-50 bg-no-repeat"
                  style={{
                    backgroundImage: cssUrl(current.src),
                    backgroundSize: '200%',
                    backgroundPosition: zoomAtPos,
                  }}
                />
              ) : null}
            </>
          ) : current.kind === 'youtube' ? (
            <div className="flex h-full w-full items-center bg-black">
              <iframe
                src={current.src}
                title={`${alt} video`}
                loading="lazy"
                allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
                allowFullScreen
                className="aspect-video w-full border-0"
              />
            </div>
          ) : (
            <div className="flex h-full w-full items-center bg-black">
              <video
                src={current.src}
                controls
                playsInline
                preload="metadata"
                className="max-h-full w-full"
                aria-label={`${alt} video`}
              />
            </div>
          )}

          {count > 1 ? (
            <>
              <button
                type="button"
                aria-label="Previous"
                onClick={(e) => {
                  e.stopPropagation();
                  go(-1);
                }}
                className="absolute left-2 top-1/2 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-gray-800 opacity-0 shadow transition-opacity focus-visible:opacity-100 group-hover:opacity-100 lg:flex"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <button
                type="button"
                aria-label="Next"
                onClick={(e) => {
                  e.stopPropagation();
                  go(1);
                }}
                className="absolute right-2 top-1/2 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-gray-800 opacity-0 shadow transition-opacity focus-visible:opacity-100 group-hover:opacity-100 lg:flex"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            </>
          ) : null}
        </div>

        <p className="sr-only" aria-live="polite">
          {count > 1 ? `${label(current, at)} of ${count}` : ''}
        </p>

        {count > 1 ? (
          <div className="flex flex-wrap justify-center md:hidden">
            {slides.map((s, i) => (
              <button
                key={`${s.kind}-${s.src}-${i}`}
                type="button"
                aria-label={`Show ${label(s, i).toLowerCase()}`}
                aria-current={i === at ? 'true' : undefined}
                onClick={() => setIndex(i)}
                className="flex h-11 min-w-[22px] items-center justify-center"
              >
                <span
                  className={clsx(
                    'block h-1.5 rounded-full transition-all',
                    i === at ? 'w-4 bg-[var(--primary)]' : 'w-1.5 bg-gray-300',
                  )}
                />
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {count > 1 ? (
        <div
          className={clsx(
            'hidden gap-2 overflow-x-auto p-1 md:flex',
            side && 'lg:max-h-[560px] lg:w-[4.75rem] lg:shrink-0 lg:flex-col lg:overflow-y-auto lg:overflow-x-hidden',
          )}
        >
          {slides.map((s, i) => (
            <button
              key={`${s.kind}-${s.src}-${i}`}
              type="button"
              aria-label={`Show ${label(s, i).toLowerCase()}`}
              aria-current={i === at ? 'true' : undefined}
              onClick={() => {
                setZoomAtPos(null);
                setIndex(i);
              }}
              className={clsx(
                'relative h-16 w-16 shrink-0 overflow-hidden rounded-lg border-2 bg-gray-50',
                i === at ? 'border-[var(--primary)]' : 'border-gray-200 hover:border-gray-400',
              )}
            >
              {s.kind === 'image' ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={s.src} alt="" loading="lazy" className="h-full w-full object-contain p-1" />
              ) : (
                <span className="flex h-full w-full items-center justify-center bg-gray-900 text-white">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/20">
                    <Play className="h-4 w-4 fill-current" aria-hidden />
                  </span>
                </span>
              )}
            </button>
          ))}
        </div>
      ) : null}

      {lightbox !== null ? (
        <Lightbox
          images={pics}
          start={lightbox}
          alt={alt}
          onClose={(i) => {
            setLightbox(null);
            setIndex(i);
          }}
        />
      ) : null}
    </div>
  );
}

type View = { scale: number; x: number; y: number };
const IDENTITY: View = { scale: 1, x: 0, y: 0 };
type Point = { x: number; y: number };

function Lightbox({
  images,
  start,
  alt,
  onClose,
}: {
  images: string[];
  start: number;
  alt: string;
  onClose: (index: number) => void;
}) {
  const mounted = useMounted();
  const [idx, setIdx] = useState(start);
  const [view, setViewState] = useState<View>(IDENTITY);
  const [active, setActive] = useState(false);
  const viewRef = useRef<View>(IDENTITY);
  const boxRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const pointers = useRef(new Map<number, Point>());
  const pinch = useRef<{ dist: number; from: View } | null>(null);
  const pan = useRef<{ x: number; y: number; from: View } | null>(null);
  const multi = useRef(false);
  const lastTap = useRef<Tap | null>(null);
  const count = images.length;

  const setView = useCallback((v: View) => {
    viewRef.current = v;
    setViewState(v);
  }, []);

  const clamped = useCallback((v: View): View => {
    const r = boxRef.current?.getBoundingClientRect();
    const scale = clampScale(v.scale);
    if (!r || scale === 1) return { scale, x: 0, y: 0 };
    return { scale, x: clampPan(v.x, scale, r.width), y: clampPan(v.y, scale, r.height) };
  }, []);

  const go = useCallback(
    (step: number) => {
      setView(IDENTITY);
      setIdx((i) => stepIndex(i, step, count));
    },
    [count, setView],
  );

  const close = useCallback(() => onClose(idx), [onClose, idx]);
  useOverlay(true, close, closeRef);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') go(1);
      else if (e.key === 'ArrowLeft') go(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go]);

  /** Pointer position relative to the centre of the image box. */
  const rel = (e: { clientX: number; clientY: number }): Point => {
    const r = boxRef.current?.getBoundingClientRect();
    if (!r) return { x: 0, y: 0 };
    return { x: e.clientX - (r.left + r.width / 2), y: e.clientY - (r.top + r.height / 2) };
  };

  const distance = () => {
    const [a, b] = [...pointers.current.values()];
    return Math.hypot(a.x - b.x, a.y - b.y) || 1;
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, rel(e));
    setActive(true);
    if (pointers.current.size === 2) {
      multi.current = true;
      pan.current = null;
      pinch.current = { dist: distance(), from: viewRef.current };
    } else if (pointers.current.size === 1) {
      multi.current = false;
      const p = rel(e);
      pan.current = { x: p.x, y: p.y, from: viewRef.current };
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, rel(e));
    if (pointers.current.size >= 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()];
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const scale = clampScale((pinch.current.from.scale * distance()) / pinch.current.dist);
      const pos = zoomAt(mid, pinch.current.from, scale);
      setView(clamped({ scale, ...pos }));
    } else if (pan.current && viewRef.current.scale > 1) {
      const p = rel(e);
      const { from } = pan.current;
      setView(clamped({ scale: from.scale, x: from.x + p.x - pan.current.x, y: from.y + p.y - pan.current.y }));
    }
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    const p = rel(e);
    pointers.current.delete(e.pointerId);
    const remaining = [...pointers.current.values()];
    if (remaining.length === 1) {
      // Pinch over: keep panning with the finger still down.
      pinch.current = null;
      pan.current = { x: remaining[0].x, y: remaining[0].y, from: viewRef.current };
      return;
    }
    if (remaining.length > 0) return;
    setActive(false);
    const startAt = pan.current;
    pan.current = null;
    pinch.current = null;
    if (multi.current || !startAt) return;
    const dx = p.x - startAt.x;
    const dy = p.y - startAt.y;
    if (viewRef.current.scale === 1) {
      const dir = swipeDirection(dx, dy);
      if (dir !== 0 && count > 1) {
        lastTap.current = null;
        go(dir);
        return;
      }
    }
    if (Math.abs(dx) > 10 || Math.abs(dy) > 10) return;
    const tap = { t: e.timeStamp, x: p.x, y: p.y };
    if (isDoubleTap(lastTap.current, tap)) {
      lastTap.current = null;
      const from = viewRef.current;
      if (from.scale > 1) setView(IDENTITY);
      else setView(clamped({ scale: DOUBLE_TAP_ZOOM, ...zoomAt(p, from, DOUBLE_TAP_ZOOM) }));
    } else {
      lastTap.current = tap;
    }
  };

  const onPointerCancel = (e: React.PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size === 0) {
      pan.current = null;
      pinch.current = null;
      setActive(false);
    }
  };

  if (!mounted) return null;
  const src = images[Math.min(idx, count - 1)];

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${alt} photos`}
      className="fixed inset-0 z-[120] flex flex-col bg-black/95 text-white"
    >
      <div className="flex items-center justify-between px-3 pt-[max(0.5rem,env(safe-area-inset-top))]">
        <span className="text-sm text-white/70" aria-live="polite">
          {count > 1 ? `${idx + 1} / ${count}` : ''}
        </span>
        <button
          ref={closeRef}
          type="button"
          aria-label="Close"
          onClick={close}
          className="flex h-11 w-11 items-center justify-center rounded-full bg-white/15 hover:bg-white/25"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div
        ref={boxRef}
        className="relative min-h-0 flex-1 overflow-hidden"
        style={{ touchAction: 'none', cursor: view.scale > 1 ? 'grab' : 'zoom-in' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={count > 1 ? `${alt} – photo ${idx + 1}` : alt}
          draggable={false}
          className={clsx(
            'absolute inset-0 m-auto h-full w-full select-none object-contain p-2',
            !active && 'transition-transform duration-200',
          )}
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
        />
        {count > 1 ? (
          <>
            <button
              type="button"
              aria-label="Previous photo"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => go(-1)}
              className="absolute left-3 top-1/2 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/15 hover:bg-white/25 sm:flex"
            >
              <ChevronLeft className="h-6 w-6" />
            </button>
            <button
              type="button"
              aria-label="Next photo"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => go(1)}
              className="absolute right-3 top-1/2 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/15 hover:bg-white/25 sm:flex"
            >
              <ChevronRight className="h-6 w-6" />
            </button>
          </>
        ) : null}
      </div>

      <div className="pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2">
        {count > 1 ? (
          <div className="overflow-x-auto px-3">
            <div className="mx-auto flex w-max gap-2">
              {images.map((s, i) => (
                <button
                  key={`${s}-${i}`}
                  type="button"
                  aria-label={`Show photo ${i + 1}`}
                  aria-current={i === idx ? 'true' : undefined}
                  onClick={() => {
                    setView(IDENTITY);
                    setIdx(i);
                  }}
                  className={clsx(
                    'h-12 w-12 shrink-0 overflow-hidden rounded-md border-2',
                    i === idx ? 'border-white' : 'border-transparent opacity-60',
                  )}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={s} alt="" className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          </div>
        ) : null}
        <p className="mt-2 text-center text-[11px] text-white/50">Pinch or double-tap to zoom</p>
      </div>
    </div>,
    document.body,
  );
}
