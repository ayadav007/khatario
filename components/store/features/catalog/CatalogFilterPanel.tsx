'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { StoreFacets } from '@/lib/store/store-facets-query';
import { clearCatalogFilters, type CatalogFilterValue } from './catalog-filters';
import { createPendingFilters } from './pending-filters';
import { useOverlay } from '@/components/store/features/product/useOverlay';

const rupees = (n: number) => `₹${n.toLocaleString('en-IN')}`;
const PRICE_DEBOUNCE_MS = 400;

type Props = {
  facets: StoreFacets;
  value: CatalogFilterValue;
  onChange: (next: CatalogFilterValue) => void;
  layout: 'sidebar' | 'sheet';
  open?: boolean;
  onClose?: () => void;
};

function toggle(list: string[], item: string): string[] {
  return list.includes(item) ? list.filter((x) => x !== item) : [...list, item];
}

function parsePrice(raw: string): number | null {
  const n = Number(raw);
  return raw.trim() !== '' && Number.isFinite(n) && n >= 0 ? n : null;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="border-b border-gray-200 py-4 last:border-b-0">
      <legend className="mb-2 text-sm font-semibold text-gray-900">{title}</legend>
      {children}
    </fieldset>
  );
}

function CheckRow({
  type,
  name,
  checked,
  onChange,
  label,
  count,
}: {
  type: 'checkbox' | 'radio';
  name?: string;
  checked: boolean;
  onChange: () => void;
  label: string;
  count?: number;
}) {
  return (
    <label className="flex min-h-[44px] cursor-pointer items-center gap-3 text-sm text-gray-800">
      <input
        type={type}
        name={name}
        checked={checked}
        onChange={onChange}
        className="h-5 w-5 shrink-0 accent-[var(--primary)]"
      />
      <span className="flex-1">{label}</span>
      {count != null && <span className="text-xs text-gray-500">{count}</span>}
    </label>
  );
}

const PRICE_INPUT =
  'mt-1 min-h-[44px] w-full rounded-lg border border-gray-300 bg-[var(--paper,#fff)] px-3 text-sm text-gray-900';

export function CatalogFilterPanel({ facets, value, onChange, layout, open, onClose }: Props) {
  const isSheet = layout === 'sheet';
  // Sheet edits are staged in `draft` and only sent on Apply. Sidebar edits go through a pending
  // buffer so they build on the latest local value, not on props that arrive late via the URL.
  const [draft, setDraft] = useState<CatalogFilterValue>(value);
  useEffect(() => {
    if (isSheet && open) setDraft(value);
    // Re-stage only when the sheet opens, not on every parent update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSheet, open]);

  // Sheet: Escape closes, body scroll is locked (shared counter) and focus moves to Close.
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  useOverlay(isSheet && !!open, () => onClose?.(), closeBtnRef);

  const [side, setSide] = useState<CatalogFilterValue>(value);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const pendingRef = useRef<ReturnType<typeof createPendingFilters> | null>(null);
  if (!pendingRef.current) {
    pendingRef.current = createPendingFilters(value, (v) => onChangeRef.current(v), setSide, PRICE_DEBOUNCE_MS);
  }
  const pending = pendingRef.current;
  pending.sync(value);
  useEffect(() => () => pending.dispose(), [pending]);

  const current = isSheet ? draft : side;
  const [minText, setMinText] = useState(current.min != null ? String(current.min) : '');
  const [maxText, setMaxText] = useState(current.max != null ? String(current.max) : '');
  useEffect(() => {
    // Leave the text alone while it already parses to the stored value (e.g. "12." mid-typing).
    setMinText((t) => (parsePrice(t) === current.min ? t : current.min != null ? String(current.min) : ''));
    setMaxText((t) => (parsePrice(t) === current.max ? t : current.max != null ? String(current.max) : ''));
  }, [current.min, current.max]);

  const update = (patch: Partial<CatalogFilterValue>, debounce = false) => {
    if (isSheet) setDraft((d) => ({ ...d, ...patch }));
    else pending.patch(patch, debounce);
  };

  const onPrice = (which: 'min' | 'max', raw: string) => {
    if (which === 'min') setMinText(raw);
    else setMaxText(raw);
    update({ [which]: parsePrice(raw) } as Partial<CatalogFilterValue>, true);
  };

  const body = (
    <div className="px-4">
      <Section title="Price">
        <div className="flex items-center gap-2">
          <label className="flex-1 text-xs text-gray-600">
            Min price
            <input
              type="number"
              inputMode="numeric"
              min={0}
              value={minText}
              placeholder={rupees(facets.price.min)}
              onChange={(e) => onPrice('min', e.target.value)}
              className={PRICE_INPUT}
            />
          </label>
          <span aria-hidden className="pt-5 text-gray-400">
            –
          </span>
          <label className="flex-1 text-xs text-gray-600">
            Max price
            <input
              type="number"
              inputMode="numeric"
              min={0}
              value={maxText}
              placeholder={rupees(facets.price.max)}
              onChange={(e) => onPrice('max', e.target.value)}
              className={PRICE_INPUT}
            />
          </label>
        </div>
      </Section>

      {facets.categories.length > 0 && (
        <Section title="Category">
          {facets.categories.map((c) => (
            <CheckRow
              key={c.id}
              type="checkbox"
              checked={current.categoryIds.includes(c.id)}
              onChange={() => update({ categoryIds: toggle(current.categoryIds, c.id) })}
              label={c.name}
              count={c.count}
            />
          ))}
        </Section>
      )}

      {facets.brands.length > 0 && (
        <Section title="Brand">
          {facets.brands.map((b) => (
            <CheckRow
              key={b.name}
              type="checkbox"
              checked={current.brands.includes(b.name)}
              onChange={() => update({ brands: toggle(current.brands, b.name) })}
              label={b.name}
              count={b.count}
            />
          ))}
        </Section>
      )}

      <Section title="Availability">
        <CheckRow
          type="checkbox"
          checked={current.inStock}
          onChange={() => update({ inStock: !current.inStock })}
          label="In stock only"
          count={facets.inStock}
        />
      </Section>

      {facets.discount.length > 0 && (
        <Section title="Discount">
          {facets.discount.map((d) => (
            <CheckRow
              key={d.pct}
              type="radio"
              name={`catalog-discount-${layout}`}
              checked={current.disc === d.pct}
              onChange={() => update({ disc: d.pct })}
              label={`${d.pct}% off or more`}
              count={d.count}
            />
          ))}
          {current.disc != null && (
            <button
              type="button"
              onClick={() => update({ disc: null })}
              className="min-h-[44px] text-sm text-[var(--primary)] underline"
            >
              Any discount
            </button>
          )}
        </Section>
      )}
    </div>
  );

  if (!isSheet) return <div aria-label="Filters">{body}</div>;
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Filters">
      <button type="button" aria-label="Close filters" onClick={onClose} className="absolute inset-0 bg-black/40" />
      <div className="absolute inset-x-0 bottom-0 flex max-h-[85vh] flex-col rounded-t-2xl bg-[var(--paper,#fff)] shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-1">
          <h2 className="text-base font-semibold text-gray-900">Filters</h2>
          <button
            ref={closeBtnRef}
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-11 w-11 items-center justify-center text-gray-600"
          >
            ✕
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">{body}</div>
        <div
          className="flex gap-3 border-t border-gray-200 px-4 pt-3"
          style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 12px)' }}
        >
          <button
            type="button"
            onClick={() => setDraft(clearCatalogFilters(draft))}
            className="min-h-[44px] flex-1 rounded-lg border border-gray-300 text-sm font-medium text-gray-800"
          >
            Clear
          </button>
          <button
            type="button"
            onClick={() => {
              onChange(draft);
              onClose?.();
            }}
            className="min-h-[44px] flex-[2] rounded-lg bg-[var(--primary)] text-sm font-semibold text-white"
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}
