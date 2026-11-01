'use client';

import type { StoreFacets } from '@/lib/store/store-facets-query';
import { activeFilterCount, type CatalogFilterValue } from './catalog-filters';

export type FilterChipKey = 'cat' | 'brand' | 'price' | 'stock' | 'disc';

const rupees = (n: number) => `₹${n.toLocaleString('en-IN')}`;

export function ActiveFilterChips({
  value,
  facets,
  onRemove,
  onClear,
}: {
  value: CatalogFilterValue;
  facets: StoreFacets | null;
  onRemove: (key: FilterChipKey, item?: string) => void;
  onClear: () => void;
}) {
  if (activeFilterCount(value) === 0) return null;

  const chips: { id: string; label: string; key: FilterChipKey; item?: string }[] = [];
  for (const id of value.categoryIds) {
    const name = facets?.categories.find((c) => c.id === id)?.name ?? 'Category';
    chips.push({ id: `cat-${id}`, label: name, key: 'cat', item: id });
  }
  for (const b of value.brands) chips.push({ id: `brand-${b}`, label: b, key: 'brand', item: b });
  if (value.min != null || value.max != null) {
    const label =
      value.min != null && value.max != null
        ? `${rupees(value.min)} – ${rupees(value.max)}`
        : value.min != null
          ? `${rupees(value.min)} and above`
          : `Up to ${rupees(value.max as number)}`;
    chips.push({ id: 'price', label, key: 'price' });
  }
  if (value.inStock) chips.push({ id: 'stock', label: 'In stock only', key: 'stock' });
  if (value.disc != null) chips.push({ id: 'disc', label: `${value.disc}% off or more`, key: 'disc' });

  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Active filters">
      {chips.map((c) => (
        <button
          key={c.id}
          type="button"
          onClick={() => onRemove(c.key, c.item)}
          aria-label={`Remove filter: ${c.label}`}
          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-[var(--primary)] bg-[var(--paper,#fff)] px-3 text-sm text-gray-900"
        >
          <span>{c.label}</span>
          <span aria-hidden className="text-gray-500">
            ✕
          </span>
        </button>
      ))}
      <button
        type="button"
        onClick={onClear}
        className="min-h-[44px] px-2 text-sm font-medium text-[var(--primary)] underline"
      >
        Clear all
      </button>
    </div>
  );
}
