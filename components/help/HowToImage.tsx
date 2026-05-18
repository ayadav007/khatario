'use client';

import { useState } from 'react';
import { Image as ImageLucide } from 'lucide-react';

type HowToImageProps = {
  src: string;
  alt: string;
  caption?: string;
};

export function HowToImage({ src, alt, caption }: HowToImageProps) {
  const [loaded, setLoaded] = useState(true);

  if (!loaded) {
    return (
      <figure className="my-8">
        <div className="overflow-hidden rounded-xl border border-border bg-slate-50/80 dark:bg-slate-900/40">
          <div className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center sm:py-16">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/80 dark:bg-slate-800 dark:ring-slate-600">
              <ImageLucide className="h-7 w-7 text-slate-400" strokeWidth={1.25} aria-hidden />
            </div>
            <div>
              <p className="text-sm font-medium text-text-primary">Visual guide coming soon</p>
              <p className="mt-1 text-sm text-text-secondary">
                We&apos;re preparing a screenshot for this step. The written steps above have the full detail.
              </p>
            </div>
          </div>
        </div>
        {caption && (
          <figcaption className="mt-3 text-center text-sm text-text-muted">{caption}</figcaption>
        )}
      </figure>
    );
  }

  return (
    <figure className="my-8">
      <div className="overflow-hidden rounded-xl border border-slate-200/90 bg-white shadow-sm ring-1 ring-slate-900/5 dark:border-slate-700 dark:bg-slate-950/30">
        {/* eslint-disable-next-line @next/next/no-img-element -- optional assets; onError handled */}
        <img
          src={src}
          alt={alt}
          className="max-h-[min(70vh,520px)] w-full object-contain object-top"
          onError={() => setLoaded(false)}
        />
      </div>
      {caption && (
        <figcaption className="mt-3 text-center text-sm text-text-muted">{caption}</figcaption>
      )}
    </figure>
  );
}
