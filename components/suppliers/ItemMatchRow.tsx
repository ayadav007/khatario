'use client';

import React, { useState } from 'react';
import { ItemAutocomplete } from '@/components/ui/ItemAutocomplete';

export type ItemMatchSuggestion = { id: string; name: string; unit: string | null; score: number };

export type ItemMatchValue = { itemId: string; itemName: string; unit: string | null; factor: string };

/**
 * One supplier item and the buyer's own item it stands for, with "how many of mine in one of
 * theirs". Suggestions come first; any own item can be searched instead.
 */
export function ItemMatchRow({
  vendorName,
  vendorUnit,
  detail,
  suggestions,
  value,
  onChange,
}: {
  vendorName: string;
  vendorUnit: string | null;
  detail?: string;
  suggestions: ItemMatchSuggestion[];
  value: ItemMatchValue | null;
  onChange: (value: ItemMatchValue | null) => void;
}) {
  const [query, setQuery] = useState('');
  const factor = value?.factor ?? '1';

  return (
    <div className="space-y-2 py-3">
      <div>
        <p className="font-medium text-text-primary">{vendorName}</p>
        <p className="text-xs text-text-secondary">
          Supplier's item{vendorUnit ? ` · sold per ${vendorUnit}` : ''}
          {detail ? ` · ${detail}` : ''}
        </p>
      </div>

      {suggestions.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {suggestions.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => onChange({ itemId: s.id, itemName: s.name, unit: s.unit, factor })}
              className={`rounded-full border px-3 py-1 text-xs ${
                value?.itemId === s.id
                  ? 'border-primary-500 bg-primary-50 text-primary-700'
                  : 'border-gray-300 text-text-primary hover:bg-gray-50'
              }`}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}

      <ItemAutocomplete
        value={query}
        onChange={setQuery}
        placeholder={value ? `Matched: ${value.itemName} (search to change)` : 'Search your items'}
        onSelect={(item) => {
          onChange({ itemId: item.id, itemName: item.name, unit: item.unit ?? null, factor });
          setQuery('');
        }}
      />

      {value && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-text-secondary">1 {vendorUnit || 'supplier unit'} =</span>
          <input
            type="number"
            min={0}
            step="any"
            inputMode="decimal"
            className="w-24 rounded-md border border-gray-300 px-2 py-1 text-sm"
            value={factor}
            onChange={(e) => onChange({ ...value, factor: e.target.value })}
          />
          <span className="text-text-secondary">
            {value.unit || 'units'} of {value.itemName}
          </span>
          <button type="button" className="text-xs text-text-secondary underline" onClick={() => onChange(null)}>
            Clear
          </button>
        </div>
      )}
    </div>
  );
}
