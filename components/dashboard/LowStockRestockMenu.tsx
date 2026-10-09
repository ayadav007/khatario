'use client';

import { useEffect, useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import { X } from 'lucide-react';

type Choice = 'purchase_order' | 'purchase';

type Props = {
  itemId: string;
  itemName: string;
  suggestedQty: number;
};

function restockHref(choice: Choice, itemId: string, qty: number) {
  const params = new URLSearchParams({
    item_id: itemId,
    qty: String(qty),
  });
  const path = choice === 'purchase_order' ? '/purchase-orders/new' : '/purchases/new';
  return `${path}?${params.toString()}`;
}

export function suggestedRestockQty(currentStock: unknown, minStock: unknown) {
  const current = Number(currentStock);
  const min = Number(minStock);
  const gap = (Number.isFinite(min) ? min : 0) - (Number.isFinite(current) ? current : 0);
  const qty = gap > 0 ? gap : 1;
  return Math.round(qty * 1000) / 1000;
}

export function LowStockRestockMenu({ itemId, itemName, suggestedQty }: Props) {
  const router = useRouter();
  const groupId = useId();
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<Choice | null>(null);
  const [anchor, setAnchor] = useState<{ top: number; right: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const go = (next: Choice) => {
    setOpen(false);
    router.push(restockHref(next, itemId, suggestedQty));
  };

  return (
    <>
      <button
        type="button"
        className="link-primary shrink-0 font-medium"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          setAnchor({ top: rect.bottom + 6, right: Math.max(8, window.innerWidth - rect.right) });
          setChoice(null);
          setOpen(true);
        }}
      >
        Restock
      </button>

      {open ? (
        <>
          <div className="fixed inset-0 z-40 md:hidden">
            <button
              type="button"
              className="absolute inset-0 bg-slate-900/40"
              aria-label="Close restock options"
              onClick={() => setOpen(false)}
            />
            <div
              role="dialog"
              aria-labelledby={`${groupId}-title`}
              className="absolute inset-x-0 bottom-0 rounded-t-2xl bg-surface px-4 pb-[calc(env(safe-area-inset-bottom,0px)+1rem)] pt-3 shadow-large"
            >
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 id={`${groupId}-title`} className="min-w-0 truncate text-base font-semibold text-text-primary">
                  Restock {itemName}
                </h2>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="inline-flex h-9 w-9 shrink-0 items-center justify-center text-text-secondary"
                  aria-label="Close"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div role="radiogroup" aria-label="How to restock" className="space-y-2">
                <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border px-3 py-3">
                  <input
                    type="radio"
                    name={groupId}
                    className="mt-1 h-4 w-4 text-primary-600"
                    checked={choice === 'purchase_order'}
                    onChange={() => setChoice('purchase_order')}
                  />
                  <span>
                    <span className="block text-sm font-medium text-text-primary">Create purchase order</span>
                    <span className="mt-0.5 block text-xs text-text-secondary">
                      Order from the supplier. Stock updates when you receive it.
                    </span>
                  </span>
                </label>
                <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border px-3 py-3">
                  <input
                    type="radio"
                    name={groupId}
                    className="mt-1 h-4 w-4 text-primary-600"
                    checked={choice === 'purchase'}
                    onChange={() => setChoice('purchase')}
                  />
                  <span>
                    <span className="block text-sm font-medium text-text-primary">Record purchase</span>
                    <span className="mt-0.5 block text-xs text-text-secondary">
                      You already bought it. Fill the purchase bill and add stock.
                    </span>
                  </span>
                </label>
              </div>
              <button
                type="button"
                disabled={!choice}
                onClick={() => choice && go(choice)}
                className="mt-4 flex h-11 w-full items-center justify-center rounded-lg bg-primary-600 text-sm font-semibold text-white disabled:opacity-40"
              >
                Continue
              </button>
            </div>
          </div>

          <div className="hidden md:contents">
            <button
              type="button"
              className="fixed inset-0 z-40 cursor-default"
              aria-label="Close restock options"
              onClick={() => setOpen(false)}
            />
            <div
              role="menu"
              aria-label={`Restock ${itemName}`}
              className="fixed z-50 w-64 rounded-lg border border-border bg-surface p-1 shadow-large"
              style={anchor ? { top: anchor.top, right: anchor.right } : undefined}
            >
              <button
                type="button"
                role="menuitem"
                className="block w-full rounded-md px-3 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800"
                onClick={() => go('purchase_order')}
              >
                <span className="block text-sm font-medium text-text-primary">Create purchase order</span>
                <span className="block text-xs text-text-secondary">Order from the supplier</span>
              </button>
              <button
                type="button"
                role="menuitem"
                className="block w-full rounded-md px-3 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800"
                onClick={() => go('purchase')}
              >
                <span className="block text-sm font-medium text-text-primary">Record purchase</span>
                <span className="block text-xs text-text-secondary">Already bought — fill the bill</span>
              </button>
            </div>
          </div>
        </>
      ) : null}
    </>
  );
}
