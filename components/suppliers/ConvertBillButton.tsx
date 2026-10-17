'use client';

import React, { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { useToastContext } from '@/contexts/ToastContext';
import { ItemMatchRow, type ItemMatchSuggestion, type ItemMatchValue } from '@/components/suppliers/ItemMatchRow';

type UnmatchedLine = {
  invoice_item_id: string;
  item_name: string;
  quantity: number;
  unit: string | null;
  suggestions: ItemMatchSuggestion[];
};

/**
 * Turns a connected supplier's bill into the buyer's purchase. When some lines are not matched
 * to the buyer's items yet, asks for the match (and units per supplier unit) and tries again;
 * the matches are remembered for the next bill.
 */
export function ConvertBillButton({
  invoiceId,
  onConverted,
  className,
}: {
  invoiceId: string;
  onConverted?: () => void;
  className?: string;
}) {
  const toast = useToastContext();
  const [busy, setBusy] = useState(false);
  const [unmatched, setUnmatched] = useState<UnmatchedLine[] | null>(null);
  const [choices, setChoices] = useState<Record<string, ItemMatchValue | null>>({});

  const convert = async (itemMap?: Record<string, { item_id: string; factor: number }>) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/invoices/${invoiceId}/convert-to-purchase`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(itemMap ? { item_map: itemMap } : {}),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        toast.success(`Purchase created: ${data.purchase?.bill_number || data.purchase?.id}`);
        setUnmatched(null);
        setChoices({});
        onConverted?.();
        return;
      }
      if (data.code === 'ITEMS_UNMATCHED' && Array.isArray(data.unmatched)) {
        setUnmatched(data.unmatched);
        return;
      }
      toast.error(data.error || 'Failed to convert the bill');
    } catch {
      toast.error('Failed to convert the bill');
    } finally {
      setBusy(false);
    }
  };

  const ready =
    !!unmatched &&
    unmatched.every((u) => {
      const c = choices[u.invoice_item_id];
      return c && Number(c.factor) > 0;
    });

  const submitMatches = () => {
    if (!unmatched) return;
    const itemMap: Record<string, { item_id: string; factor: number }> = {};
    for (const u of unmatched) {
      const c = choices[u.invoice_item_id];
      if (c) itemMap[u.invoice_item_id] = { item_id: c.itemId, factor: Number(c.factor) };
    }
    convert(itemMap);
  };

  return (
    <>
      <Button
        size="sm"
        variant="secondary"
        className={className}
        disabled={busy}
        onClick={() => {
          if (!confirm('Turn this bill into a purchase? Stock will be added.')) return;
          convert();
        }}
      >
        Convert to Purchase
      </Button>

      {unmatched && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-lg bg-white p-5 shadow-xl">
            <h2 className="text-lg font-semibold text-text-primary">Match the supplier's items</h2>
            <p className="mt-1 text-sm text-text-secondary">
              Pick your own item for each line and how many of yours come in one of theirs. We remember this for
              their next bill.
            </p>
            <ul className="mt-2 divide-y divide-gray-100">
              {unmatched.map((u) => (
                <li key={u.invoice_item_id}>
                  <ItemMatchRow
                    vendorName={u.item_name}
                    vendorUnit={u.unit}
                    detail={`${u.quantity} on this bill`}
                    suggestions={u.suggestions}
                    value={choices[u.invoice_item_id] ?? null}
                    onChange={(v) => setChoices((prev) => ({ ...prev, [u.invoice_item_id]: v }))}
                  />
                </li>
              ))}
            </ul>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setUnmatched(null)} disabled={busy}>
                Cancel
              </Button>
              <Button onClick={submitMatches} disabled={!ready || busy}>
                {busy ? 'Creating…' : 'Create purchase'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
