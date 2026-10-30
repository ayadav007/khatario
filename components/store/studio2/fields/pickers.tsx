'use client';

import { useEffect, useMemo, useState } from 'react';
import { Loader2, Search, X } from 'lucide-react';
import { CUSTOM_LINK, isLinkValue, linkChoice, linkOptions, toggleListItem } from '@/lib/store/engine/editor/fields';
import { fetchItem, searchItems, type ItemSummary } from '../api';

export const inputCls =
  'w-full rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-900 focus:border-gray-500 focus:outline-none disabled:bg-gray-50 disabled:text-gray-500';

type Category = { id: string; name: string };

// ---- Link picker -------------------------------------------------------------------------------

export function LinkPicker({
  id,
  value,
  categories,
  onChange,
}: {
  id: string;
  value: string;
  categories: Category[];
  onChange(v: string): void;
}) {
  const choice = linkChoice(value, categories);
  // "Custom URL" stays open while the merchant types, even before the value is set.
  const [custom, setCustom] = useState(choice === CUSTOM_LINK);
  const showCustom = custom || choice === CUSTOM_LINK;
  const options = useMemo(() => linkOptions(categories), [categories]);
  // What the merchant is typing; the stored link changes only to a valid value (or '' when cleared),
  // so a half-typed address never reaches the server, which would drop it to the default.
  const [draft, setDraft] = useState<string | null>(null);
  const invalid = draft !== null && draft.trim() !== '' && !isLinkValue(draft);

  return (
    <div className="space-y-1.5">
      <select
        id={id}
        className={inputCls}
        value={showCustom ? CUSTOM_LINK : choice}
        onChange={(e) => {
          const v = e.target.value;
          if (v === CUSTOM_LINK) {
            setCustom(true); // the merchant types the address; the stored link changes when they do
            return;
          }
          setCustom(false);
          setDraft(null);
          onChange(v);
        }}
      >
        <option value="">No link</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
        <option value={CUSTOM_LINK}>Custom URL…</option>
      </select>
      {showCustom && (
        <input
          className={inputCls}
          value={draft ?? value}
          placeholder="https://"
          aria-label="Custom URL"
          aria-invalid={invalid}
          onChange={(e) => {
            const text = e.target.value;
            setDraft(text);
            if (text.trim() === '') onChange('');
            else if (isLinkValue(text)) onChange(text.trim());
          }}
          // A valid draft is already stored; an invalid one stays visible with its hint.
          onBlur={() => !invalid && setDraft(null)}
        />
      )}
      {invalid && <p className="text-xs text-red-600">Use a full https:// address</p>}
    </div>
  );
}

// ---- Product picker ----------------------------------------------------------------------------

// Names of products already picked (chips show names; settings store ids).
const nameCache = new Map<string, string | null>();
const pending = new Map<string, Promise<void>>();

function rememberItems(items: ItemSummary[]) {
  for (const i of items) nameCache.set(i.id, i.name);
}

function useItemNames(ids: string[]): Record<string, string | null | undefined> {
  const [, bump] = useState(0);
  const key = ids.join(',');
  useEffect(() => {
    let alive = true;
    for (const id of ids) {
      if (nameCache.has(id)) continue;
      let p = pending.get(id);
      if (!p) {
        p = fetchItem(id)
          .then((item) => {
            nameCache.set(id, item?.name ?? null);
          })
          .catch(() => undefined)
          .finally(() => pending.delete(id));
        pending.set(id, p);
      }
      void p.then(() => alive && bump((n) => n + 1));
    }
    return () => {
      alive = false;
    };
    // ids is represented by key
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const out: Record<string, string | null | undefined> = {};
  for (const id of ids) out[id] = nameCache.get(id);
  return out;
}

export function ProductPicker({
  id,
  value,
  max,
  disabled,
  onChange,
}: {
  id: string;
  /** Picked ids, in order. A single `product` setting passes max 1. */
  value: string[];
  max: number;
  disabled: boolean;
  onChange(ids: string[]): void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ItemSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const names = useItemNames(value);
  const full = value.length >= max;

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults([]);
      setLoading(false);
      setError(null);
      return;
    }
    const ctl = new AbortController();
    setLoading(true);
    const t = setTimeout(() => {
      searchItems(q, ctl.signal)
        .then((items) => {
          rememberItems(items);
          setResults(items);
          setError(null);
        })
        .catch((e) => {
          if (ctl.signal.aborted) return;
          setError(e instanceof Error ? e.message : 'Search failed');
        })
        .finally(() => !ctl.signal.aborted && setLoading(false));
    }, 300);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [query]);

  const pick = (item: ItemSummary) => {
    if (max === 1) onChange([item.id]);
    else onChange(toggleListItem(value, item.id, max));
  };

  return (
    <div className="space-y-2">
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {value.map((pid) => (
            <li
              key={pid}
              className="inline-flex max-w-full items-center gap-1 rounded-full bg-gray-100 py-0.5 pl-2.5 pr-1 text-xs text-gray-800"
            >
              <span className="truncate">{names[pid] === undefined ? 'Loading…' : names[pid] ?? 'Removed product'}</span>
              <button
                type="button"
                aria-label={`Remove ${names[pid] ?? 'product'}`}
                className="rounded-full p-0.5 text-gray-500 hover:bg-gray-200 hover:text-gray-800 disabled:opacity-40"
                onClick={() => onChange(value.filter((x) => x !== pid))}
              >
                <X className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="relative">
        <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
        <input
          id={id}
          type="search"
          className={`${inputCls} pl-7`}
          placeholder={full && max > 1 ? `Up to ${max} products` : 'Search products'}
          value={query}
          disabled={disabled || (full && max > 1)}
          onChange={(e) => setQuery(e.target.value)}
        />
        {loading && <Loader2 className="absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-gray-400" />}
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      {query.trim() && !loading && !error && results.length === 0 && <p className="text-xs text-gray-500">No products found</p>}
      {results.length > 0 && (
        <ul className="max-h-48 overflow-y-auto rounded-md border border-gray-200">
          {results.map((item) => {
            const picked = value.includes(item.id);
            return (
              <li key={item.id}>
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left text-sm hover:bg-gray-50 disabled:opacity-40"
                  disabled={!picked && full && max > 1}
                  aria-pressed={picked}
                  onClick={() => pick(item)}
                >
                  <span className="truncate">{item.name}</span>
                  {picked && <span className="text-xs text-gray-500">Picked</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ---- Category picker ---------------------------------------------------------------------------

export function CategorySelect({
  id,
  value,
  categories,
  onChange,
}: {
  id: string;
  value: string;
  categories: Category[];
  onChange(v: string | undefined): void;
}) {
  const known = !value || categories.some((c) => c.id === value);
  return (
    <select id={id} className={inputCls} value={value} onChange={(e) => onChange(e.target.value || undefined)}>
      <option value="">Choose a category</option>
      {!known && <option value={value}>Removed category</option>}
      {categories.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
    </select>
  );
}

export function CategoryList({
  value,
  categories,
  max,
  onChange,
}: {
  value: string[];
  categories: Category[];
  max: number;
  onChange(ids: string[]): void;
}) {
  if (categories.length === 0) return <p className="text-xs text-gray-500">No categories yet</p>;
  const full = value.length >= max;
  return (
    <ul className="max-h-48 space-y-1 overflow-y-auto rounded-md border border-gray-200 p-2">
      {categories.map((c) => {
        const checked = value.includes(c.id);
        return (
          <li key={c.id}>
            <label className="flex items-center gap-2 text-sm text-gray-800">
              <input
                type="checkbox"
                checked={checked}
                disabled={!checked && full}
                onChange={() => onChange(toggleListItem(value, c.id, max))}
              />
              <span className="truncate">{c.name}</span>
            </label>
          </li>
        );
      })}
    </ul>
  );
}
