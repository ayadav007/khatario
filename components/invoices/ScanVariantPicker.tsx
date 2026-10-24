'use client';

import React from 'react';

export interface PickableVariant {
  id: string;
  variant_name: string;
  selling_price?: number | string | null;
  current_stock?: number | string | null;
  attributes?: unknown;
}

interface ScanVariantPickerProps {
  itemName: string;
  variants: PickableVariant[];
  onPick: (variant: PickableVariant) => void;
  onCancel: () => void;
}

/**
 * A scanned barcode shared by several pack sizes (Scan & Add saves sizes without their own
 * barcodes): ask which size goes on the bill. Same look as the purchase picker's variant sheet.
 */
export function ScanVariantPicker({ itemName, variants, onPick, onCancel }: ScanVariantPickerProps) {
  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Choose size"
    >
      <div className="max-h-[70vh] w-full overflow-auto rounded-t-xl border border-border bg-white p-4 shadow-lg sm:max-w-md sm:rounded-xl dark:bg-slate-900">
        <div className="mb-1 text-sm font-semibold text-text-primary">{itemName}</div>
        <div className="mb-3 text-xs text-text-secondary">Which size is this?</div>
        <ul className="space-y-2">
          {variants.map((v) => (
            <li key={v.id}>
              <button
                type="button"
                className="w-full rounded-lg border border-border px-3 py-2.5 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-800"
                onClick={() => onPick(v)}
              >
                <span className="font-medium">{v.variant_name}</span>
                <span className="ml-2 text-text-muted">
                  Stock {Number(v.current_stock || 0)}
                  {v.selling_price != null && v.selling_price !== '' ? ` · ₹${v.selling_price}` : ''}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <button
          type="button"
          className="mt-3 w-full rounded-lg border border-border py-2 text-sm text-text-secondary"
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
