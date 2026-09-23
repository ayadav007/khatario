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
import type { StoreCategoryStyle } from '@/lib/store/store-theme';

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

export function StoreCategoryPills({
  categories,
  selectedId,
  onSelect,
  accent,
  style,
  images,
}: {
  categories: StoreCategoryOption[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  accent: string;
  style: StoreCategoryStyle;
  images: Record<string, string>;
}) {
  if (categories.length === 0) return null;

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
