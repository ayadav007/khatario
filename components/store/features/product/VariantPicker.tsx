'use client';

import { useEffect, useMemo, useRef } from 'react';
import clsx from 'clsx';
import { variantOptions, type StoreVariantInput } from '@/lib/store/variant-options';
import { pickVariant, preselect, selectionFromVariant, valueInStock } from './product-logic';

type Props = {
  variants: StoreVariantInput[];
  /** Selected variant id, or null. */
  value: string | null;
  onChange: (variantId: string | null) => void;
};

/** Option axes (colour, size, or one "Option" row) as swatches or chips. */
export function VariantPicker({ variants, value, onChange }: Props) {
  const axes = useMemo(() => variantOptions(variants), [variants]);
  const selection = useMemo(() => selectionFromVariant(variants, value), [variants, value]);
  const selected = value ? variants.find((v) => v.id === value) ?? null : null;
  const soldOut = selected != null && !(Number(selected.current_stock ?? 0) > 0);

  // Preselect once per variant list when nothing is chosen: the only variant, else the first in stock.
  const doneKey = useRef<string | null>(null);
  useEffect(() => {
    const r = preselect(doneKey.current, variants, value);
    doneKey.current = r.doneKey;
    if (r.emit) onChange(r.emit);
  }, [variants, value, onChange]);

  if (axes.length === 0) return null;

  // "Out of stock" goes under the last axis whose chosen value is sold out.
  const outAxis = soldOut
    ? [...axes].reverse().find((a) => selection[a.key] && !valueInStock(variants, selection, a.key, selection[a.key]))
        ?.key ?? axes[axes.length - 1].key
    : null;

  return (
    <div className="space-y-4">
      {axes.map((axis) => {
        const swatches = axis.values.every((v) => v.swatch);
        const chosen = selection[axis.key];
        const pick = (val: string) => {
          if (val === chosen) return;
          onChange(pickVariant(variants, value, axis.key, val));
        };
        return (
          <div key={axis.key}>
            <p className="mb-2 text-sm text-gray-600">
              <span className="font-semibold text-gray-900">{axis.label}</span>
              {chosen && swatches ? <span>: {chosen}</span> : null}
            </p>
            <div
              role="radiogroup"
              aria-label={axis.label}
              className={clsx('flex flex-wrap', swatches ? 'gap-1' : 'gap-2')}
              onKeyDown={(e) => {
                if (!['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(e.key)) return;
                e.preventDefault();
                const i = Math.max(0, axis.values.findIndex((v) => v.value === chosen));
                const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1;
                const next = axis.values[(i + step + axis.values.length) % axis.values.length];
                pick(next.value);
                const btns = e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]');
                btns[axis.values.indexOf(next)]?.focus();
              }}
            >
              {axis.values.map((opt, i) => {
                const on = opt.value === chosen;
                const inStock = valueInStock(variants, selection, axis.key, opt.value);
                const tabIndex = on || (!chosen && i === 0) ? 0 : -1;
                const name = inStock ? opt.value : `${opt.value} (out of stock)`;
                if (swatches) {
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      aria-label={name}
                      title={opt.value}
                      tabIndex={tabIndex}
                      onClick={() => pick(opt.value)}
                      className="relative flex h-11 w-11 items-center justify-center rounded-full"
                    >
                      <span
                        className={clsx(
                          'block h-8 w-8 rounded-full border border-gray-300',
                          on && 'ring-2 ring-[var(--primary)] ring-offset-2',
                          !inStock && 'opacity-50',
                        )}
                        style={{ backgroundColor: opt.swatch ?? undefined }}
                      />
                      {!inStock ? (
                        <span
                          aria-hidden
                          className="pointer-events-none absolute left-1/2 top-1/2 h-px w-9 -translate-x-1/2 -translate-y-1/2 -rotate-45 bg-gray-500"
                        />
                      ) : null}
                    </button>
                  );
                }
                return (
                  <button
                    key={opt.value}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    aria-label={name}
                    tabIndex={tabIndex}
                    onClick={() => pick(opt.value)}
                    className={clsx(
                      'min-h-[44px] min-w-[44px] rounded-lg border px-3.5 text-sm font-medium transition-colors',
                      on
                        ? 'border-[var(--primary)] bg-[var(--paper,#fff)] text-gray-900 ring-1 ring-[var(--primary)]'
                        : 'border-gray-300 bg-[var(--paper,#fff)] text-gray-800 hover:border-gray-500',
                      !inStock && 'text-gray-400 line-through decoration-gray-400',
                    )}
                  >
                    {opt.value}
                  </button>
                );
              })}
            </div>
            {outAxis === axis.key ? <p className="mt-2 text-sm font-semibold text-gray-700">Out of stock</p> : null}
          </div>
        );
      })}
    </div>
  );
}
