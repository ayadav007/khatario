'use client';

import clsx from 'clsx';
import { useEffect, useRef } from 'react';
import type { StoreCategoryStyle } from '@/lib/store/store-theme';
import { chowkInkOn, chowkOnAccent } from '@/lib/store/store-theme';

export interface StoreCategoryOption {
  id: string;
  name: string;
}

/** Khatario pack category rail. */
export function StoreCategoryPills({
  categories,
  selectedId,
  onSelect,
  accent,
  style,
  images = {},
  paper = '#f3eee6',
}: {
  categories: StoreCategoryOption[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  accent: string;
  style: StoreCategoryStyle;
  images?: Record<string, string>;
  paper?: string;
}) {
  const railRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    const active = rail.querySelector<HTMLElement>('[aria-current="true"]');
    if (!active) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const left = active.offsetLeft - (rail.clientWidth - active.clientWidth) / 2;
    rail.scrollTo({ left: Math.max(0, left), behavior: reduce ? 'auto' : 'smooth' });
  }, [selectedId]);

  if (categories.length === 0) return null;

  const ink = chowkInkOn(paper);
  const items: Array<{ id: string | null; name: string }> = [{ id: null, name: 'All' }, ...categories];

  return (
    <nav id="categories" className="pb-1" aria-label="Categories">
      <div ref={railRef} className="store-chowk-rail flex gap-1.5 overflow-x-auto pb-2 pr-6 pt-1">
        {items.map((cat) => {
          const selected = selectedId === cat.id;
          const photo = style === 'photo' && cat.id && images[cat.id];
          return (
            <button
              key={cat.id ?? 'all'}
              type="button"
              onClick={() => onSelect(cat.id)}
              aria-current={selected ? true : undefined}
              className={clsx(
                'flex-shrink-0',
                photo
                  ? 'flex w-[4.5rem] flex-col items-center gap-1'
                  : clsx(
                      'h-9 max-w-[min(70vw,14rem)] truncate rounded-full px-3.5 text-[13px] font-medium',
                      !selected && 'bg-white shadow-sm',
                    ),
              )}
              style={
                photo
                  ? { color: ink }
                  : selected
                    ? { backgroundColor: accent, color: chowkOnAccent(accent) }
                    : { color: ink, opacity: 0.9 }
              }
            >
              {photo ? (
                <>
                  <span
                    className={clsx('flex h-14 w-14 overflow-hidden rounded-2xl bg-gray-100', selected && 'ring-2 ring-offset-2')}
                    style={selected ? { ['--tw-ring-color' as string]: accent } : undefined}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={images[cat.id as string]} alt="" className="h-full w-full object-cover" />
                  </span>
                  <span className="line-clamp-2 w-full text-center text-[11px] font-medium">{cat.name}</span>
                </>
              ) : (
                <span className="truncate">{cat.name}</span>
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
