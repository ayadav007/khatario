'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import clsx from 'clsx';

export function StoreProductGallery({
  images,
  alt,
  accent,
}: {
  images: string[];
  alt: string;
  accent: string;
}) {
  const pics = images.filter(Boolean);
  const [index, setIndex] = useState(0);
  const [lightbox, setLightbox] = useState(false);
  const [hover, setHover] = useState(false);
  const [origin, setOrigin] = useState('50% 50%');
  const boxRef = useRef<HTMLDivElement>(null);
  const current = pics[Math.min(index, Math.max(0, pics.length - 1))] ?? '';

  useEffect(() => {
    setIndex(0);
  }, [pics[0]]);

  const onMove = useCallback((e: React.MouseEvent) => {
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    const el = boxRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * 100;
    const y = ((e.clientY - r.top) / r.height) * 100;
    setOrigin(`${x}% ${y}%`);
    setHover(true);
  }, []);

  if (!current) {
    return (
      <div className="flex h-64 items-center justify-center bg-white text-sm text-gray-400 sm:h-80">
        No photo
      </div>
    );
  }

  return (
    <>
      <div className="bg-white">
        <div
          ref={boxRef}
          className="relative mx-auto flex h-64 cursor-zoom-in items-center justify-center overflow-hidden sm:h-80"
          onMouseEnter={() => {
            if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) setHover(true);
          }}
          onMouseLeave={() => setHover(false)}
          onMouseMove={onMove}
          onClick={() => setLightbox(true)}
          role="button"
          tabIndex={0}
          aria-label="Zoom product image"
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setLightbox(true);
            }
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={current}
            alt={alt}
            className={clsx(
              'max-h-full max-w-full object-contain p-3 transition-transform duration-150',
              hover && 'max-sm:scale-100 sm:scale-[1.85]',
            )}
            style={hover ? { transformOrigin: origin } : undefined}
          />
        </div>
        {pics.length > 1 ? (
          <div className="flex gap-2 overflow-x-auto px-3 pb-3">
            {pics.map((src, i) => (
              <button
                key={src}
                type="button"
                onClick={() => setIndex(i)}
                className="h-14 w-14 shrink-0 overflow-hidden rounded-lg border bg-white"
                style={{ borderColor: i === index ? accent : '#e5e7eb' }}
                aria-label={`Photo ${i + 1}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt="" className="h-full w-full object-contain p-1" />
              </button>
            ))}
          </div>
        ) : null}
        <p className="hidden px-3 pb-2 text-center text-[11px] text-gray-400 sm:block">
          Hover the photo to zoom
        </p>
        <p className="px-3 pb-2 text-center text-[11px] text-gray-400 sm:hidden">Tap the photo to zoom</p>
      </div>

      {lightbox ? (
        <div className="fixed inset-0 z-[120] flex flex-col bg-black/90">
          <button
            type="button"
            className="absolute right-3 top-3 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-white/15 text-white"
            aria-label="Close zoom"
            onClick={() => setLightbox(false)}
          >
            <X className="h-5 w-5" />
          </button>
          <div className="flex min-h-0 flex-1 items-center justify-center p-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={current} alt={alt} className="max-h-full max-w-full object-contain" />
          </div>
          {pics.length > 1 ? (
            <div className="flex justify-center gap-2 pb-[max(1rem,env(safe-area-inset-bottom))]">
              {pics.map((src, i) => (
                <button
                  key={src}
                  type="button"
                  onClick={() => setIndex(i)}
                  className="h-12 w-12 overflow-hidden rounded-md border"
                  style={{ borderColor: i === index ? '#fff' : 'transparent' }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={src} alt="" className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
