'use client';

import React, { useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { ArrowRight } from 'lucide-react';
import type { HowToArticle } from '@/lib/help/how-to-articles';
import { clsx } from 'clsx';

export type FeaturedTileItem = {
  article: HowToArticle;
  Icon: LucideIcon;
};

type HowToFeaturedTilesProps = {
  items: FeaturedTileItem[];
  onSelect: (slug: string) => void;
};

function Thumbnail({ slug, title, Icon }: { slug: string; title: string; Icon: LucideIcon }) {
  const [ok, setOk] = useState(true);
  const src = `/help/how-to/${slug}.png`;

  if (!ok) {
    return (
      <div
        className="flex h-full min-h-[140px] w-full items-center justify-center bg-gradient-to-br from-slate-100 to-slate-200/80 dark:from-slate-800 dark:to-slate-900/80"
        aria-hidden
      >
        <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white/80 text-slate-500 shadow-sm ring-1 ring-slate-200/80 dark:bg-slate-800/90 dark:text-slate-300 dark:ring-slate-600">
          <Icon className="h-8 w-8" strokeWidth={1.4} />
        </span>
      </div>
    );
  }

  return (
    <div className="relative h-full min-h-[140px] w-full overflow-hidden bg-slate-100 dark:bg-slate-800">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        className="h-full w-full object-cover object-top"
        onError={() => setOk(false)}
      />
      <span className="sr-only">{title}</span>
    </div>
  );
}

/**
 * “Start here” row (one tile per help category). Thumbnail uses
 * public/help/how-to/{slug}.png when present; otherwise a neutral icon panel.
 */
export function HowToFeaturedTiles({ items, onSelect }: HowToFeaturedTilesProps) {
  if (items.length === 0) return null;

  return (
    <section className="mb-10" aria-labelledby="featured-guides-heading">
      <h2
        id="featured-guides-heading"
        className="mb-4 text-base font-bold tracking-tight text-slate-900 dark:text-slate-50"
      >
        Start here
      </h2>
      <p className="mb-5 max-w-2xl text-sm leading-relaxed text-slate-600 dark:text-slate-400">
        Popular starting points—pick a topic, or scroll down for the full list.
      </p>
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map(({ article, Icon }) => (
          <li key={article.slug}>
            <button
              type="button"
              onClick={() => onSelect(article.slug)}
              className={clsx(
                'group flex h-full w-full flex-col overflow-hidden rounded-2xl border border-slate-200/90 bg-white text-left shadow-sm',
                'transition-all hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md',
                'focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:border-slate-700 dark:bg-slate-900/50',
                'dark:hover:border-slate-600'
              )}
            >
              <div className="relative aspect-[16/9] w-full overflow-hidden sm:aspect-[5/3] sm:min-h-[140px]">
                <Thumbnail slug={article.slug} title={article.title} Icon={Icon} />
                <div className="absolute left-2 top-2 rounded-md bg-white/90 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600 shadow-sm backdrop-blur-sm dark:bg-slate-900/90 dark:text-slate-300">
                  {article.category}
                </div>
              </div>
              <div className="flex flex-1 flex-col p-4 sm:p-5">
                <span className="line-clamp-2 text-base font-semibold leading-snug text-slate-900 group-hover:text-primary-700 dark:text-slate-50 dark:group-hover:text-primary-400">
                  {article.title}
                </span>
                <span className="mt-1.5 line-clamp-2 flex-1 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                  {article.description}
                </span>
                <span className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-primary-600 group-hover:gap-1.5 dark:text-primary-400">
                  Read guide
                  <ArrowRight className="h-4 w-4 transition-transform" aria-hidden />
                </span>
              </div>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
