'use client';

import {
  Apple,
  Cookie,
  Droplets,
  Milk,
  Package,
  ShoppingBasket,
  Sparkles,
  Wheat,
  type LucideIcon,
} from 'lucide-react';
import clsx from 'clsx';
import { useEffect, useRef } from 'react';
import type { StoreCategoryStyle } from '@/lib/store/store-theme';
import { chowkInkOn, chowkOnAccent } from '@/lib/store/store-theme';

export interface StoreCategoryOption {
  id: string;
  name: string;
}

const ICONS: LucideIcon[] = [
  ShoppingBasket,
  Milk,
  Cookie,
  Apple,
  Wheat,
  Droplets,
  Sparkles,
  Package,
];

function iconFor(name: string): LucideIcon {
  let n = 0;
  for (let i = 0; i < name.length; i++) n += name.charCodeAt(i);
  return ICONS[n % ICONS.length];
}

function letterTone(name: string): string {
  const tones = [
    'bg-emerald-50 text-emerald-800',
    'bg-amber-50 text-amber-800',
    'bg-sky-50 text-sky-800',
    'bg-stone-100 text-stone-700',
    'bg-orange-50 text-orange-800',
  ];
  let n = 0;
  for (let i = 0; i < name.length; i++) n += name.charCodeAt(i);
  return tones[n % tones.length];
}

function ChowkCategoryRail({
  items,
  selectedId,
  onSelect,
  accent,
  style,
  paper,
  look,
  images = {},
}: {
  items: Array<{ id: string | null; name: string }>;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  accent: string;
  style: StoreCategoryStyle;
  paper: string;
  look: 'chowk' | 'atelier' | 'khatario';
  images?: Record<string, string>;
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

  const ink = chowkInkOn(paper);

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
                      look === 'atelier' && !selected && 'bg-white/70',
                      look === 'khatario' && !selected && 'bg-white shadow-sm',
                    ),
              )}
              style={
                photo
                  ? { color: ink }
                  : selected
                    ? { backgroundColor: accent, color: chowkOnAccent(accent) }
                    : {
                        backgroundColor: look === 'atelier' || look === 'khatario' ? undefined : 'transparent',
                        color: ink,
                        opacity: look === 'khatario' ? 0.9 : 0.7,
                      }
              }
            >
              {photo ? (
                <>
                  <span
                    className={clsx(
                      'flex h-14 w-14 overflow-hidden rounded-2xl bg-gray-100',
                      selected && 'ring-2 ring-offset-2',
                    )}
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

export function StoreCategoryPills({
  categories,
  selectedId,
  onSelect,
  accent,
  style,
  images,
  variant = 'classic',
  paper,
}: {
  categories: StoreCategoryOption[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  accent: string;
  style: StoreCategoryStyle;
  images: Record<string, string>;
  variant?: 'classic' | 'chowk' | 'atelier' | 'khatario';
  paper?: string;
}) {
  if (categories.length === 0) return null;

  if (variant === 'chowk' || variant === 'atelier' || variant === 'khatario') {
    const items: Array<{ id: string | null; name: string }> = [{ id: null, name: 'All' }, ...categories];
    return (
      <ChowkCategoryRail
        items={items}
        selectedId={selectedId}
        onSelect={onSelect}
        accent={accent}
        style={style}
        paper={paper || '#f3eee6'}
        look={variant}
        images={images}
      />
    );
  }

  const tile = (
    cat: { id: string | null; name: string; image?: string },
    selected: boolean,
  ) => {
    const Icon = iconFor(cat.name);
    const photo = cat.image && style === 'photo';
    return (
      <button
        key={cat.id ?? 'all'}
        type="button"
        onClick={() => onSelect(cat.id)}
        className="flex w-20 flex-shrink-0 flex-col items-center gap-1.5"
      >
        <span
          className={clsx(
            'flex h-14 w-14 items-center justify-center overflow-hidden rounded-2xl text-lg font-semibold',
            selected && 'ring-2 ring-offset-2',
            photo ? 'bg-gray-100' : style === 'letter' ? letterTone(cat.name) : 'bg-white border border-gray-100',
            cat.id === null && !photo && selected ? '' : null,
          )}
          style={selected ? { ['--tw-ring-color' as string]: accent } : undefined}
        >
          {photo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={cat.image} alt="" className="h-full w-full object-cover" />
          ) : style === 'icon' ? (
            <Icon className="h-6 w-6" style={{ color: selected ? accent : '#4b5563' }} />
          ) : (
            cat.name.slice(0, 1).toUpperCase()
          )}
        </span>
        <span className="line-clamp-2 text-center text-[11px] font-medium text-gray-700">{cat.name}</span>
      </button>
    );
  };

  return (
    <section id="categories" className="mb-6">
      <h2 className="mb-3 text-sm font-semibold text-gray-900">Shop by category</h2>
      <div className="flex gap-3 overflow-x-auto pb-1 scrollbar-hide lg:flex-wrap lg:overflow-visible">
        {tile({ id: null, name: 'All' }, selectedId === null)}
        {categories.map((cat) =>
          tile(
            { id: cat.id, name: cat.name, image: images[cat.id] },
            selectedId === cat.id,
          ),
        )}
      </div>
    </section>
  );
}
