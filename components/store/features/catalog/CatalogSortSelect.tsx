'use client';

import type { StoreItemsSort } from '@/lib/store/store-items-query';

const OPTIONS: { value: StoreItemsSort; label: string }[] = [
  { value: 'name', label: 'Name A–Z' },
  { value: 'new', label: 'Newest' },
  { value: 'bestsellers', label: 'Best sellers' },
  { value: 'price_asc', label: 'Price: low to high' },
  { value: 'price_desc', label: 'Price: high to low' },
  { value: 'discount', label: 'Biggest discount' },
  { value: 'rating', label: 'Top rated' },
];

export function CatalogSortSelect({
  value,
  onChange,
}: {
  value: StoreItemsSort;
  onChange: (next: StoreItemsSort) => void;
}) {
  return (
    <label className="inline-flex items-center gap-2 text-sm text-gray-600">
      <span className="sr-only sm:not-sr-only">Sort by</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as StoreItemsSort)}
        className="min-h-[44px] rounded-lg border border-gray-300 bg-[var(--paper,#fff)] px-3 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
      >
        {OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
