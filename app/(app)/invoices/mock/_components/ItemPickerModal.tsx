'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { clsx } from 'clsx';
import { AlertTriangle, Barcode, Minus, PackagePlus, Plus, Search, X } from 'lucide-react';
import { Kbd } from './Kbd';
import { CATEGORIES, inr, type CatalogItem } from '../_lib/mock-data';

type Props = {
  open: boolean;
  initialQuery: string;
  catalog: CatalogItem[];
  inBill: Record<string, number>;
  onClose: () => void;
  onAdd: (selection: { item: CatalogItem; qty: number }[]) => void;
  onCreateItem: () => void;
};

export function ItemPickerModal({ open, initialQuery, catalog, inBill, onClose, onAdd, onCreateItem }: Props) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [active, setActive] = useState(0);
  const [selection, setSelection] = useState<Record<string, number>>({});
  const [selectedOnly, setSelectedOnly] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery(initialQuery);
    setCategory('');
    setActive(0);
    setSelection({});
    setSelectedOnly(false);
    requestAnimationFrame(() => {
      const el = searchRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });
  }, [open, initialQuery]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return catalog.filter((c) => {
      if (category && c.category !== category) return false;
      if (selectedOnly && !selection[c.id]) return false;
      if (!q) return true;
      return (
        c.name.toLowerCase().includes(q) ||
        c.code.toLowerCase().includes(q) ||
        c.hsn.includes(q) ||
        c.category.toLowerCase().includes(q)
      );
    });
  }, [catalog, query, category, selectedOnly, selection]);

  useEffect(() => setActive(0), [query, category, selectedOnly]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-row="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const selectedEntries = Object.entries(selection).filter(([, q]) => q > 0);
  const selectedUnits = selectedEntries.reduce((s, [, q]) => s + q, 0);
  const selectedValue = selectedEntries.reduce((s, [id, q]) => {
    const item = catalog.find((c) => c.id === id);
    return s + (item ? item.salesPrice * q : 0);
  }, 0);

  const setQty = (id: string, qty: number) => setSelection((prev) => ({ ...prev, [id]: Math.max(0, qty) }));
  const bump = (id: string, delta: number) => setQty(id, (selection[id] ?? 0) + delta);

  const commit = () => {
    if (!selectedEntries.length) return;
    onAdd(
      selectedEntries
        .map(([id, qty]) => ({ item: catalog.find((c) => c.id === id)!, qty }))
        .filter((s) => s.item)
    );
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const inQtyInput = (e.target as HTMLElement).dataset.qtyInput === 'true';
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(results.length - 1, a + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === 'F7' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
      e.preventDefault();
      commit();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (inQtyInput) {
        searchRef.current?.focus();
        searchRef.current?.select();
        return;
      }
      const item = results[active];
      if (item) bump(item.id, e.shiftKey ? -1 : 1);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (inQtyInput) searchRef.current?.focus();
      else if (query) setQuery('');
      else onClose();
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[90] flex items-start justify-center bg-slate-900/50 p-4 pt-[6vh] backdrop-blur-sm"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Add items to bill"
        onKeyDown={onKeyDown}
        className="flex h-[84vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
          <div>
            <h2 className="text-base font-bold text-slate-900">Add items to bill</h2>
            <p className="text-xs text-slate-500">Select several items at once, then add them together</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 px-5 py-3">
          <div className="flex h-11 min-w-[260px] flex-1 items-center gap-2 rounded-xl border-2 border-primary-500 bg-white px-3 ring-4 ring-primary-100">
            <Search className="h-4 w-4 shrink-0 text-primary-600" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by item name, code, HSN or category"
              className="min-w-0 flex-1 bg-transparent text-sm font-medium outline-none placeholder:font-normal placeholder:text-slate-400"
            />
            <Barcode className="h-4 w-4 shrink-0 text-slate-400" />
          </div>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-primary-500 focus:ring-4 focus:ring-primary-100"
          >
            <option value="">All categories</option>
            {CATEGORIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={onCreateItem}
            className="inline-flex h-11 items-center gap-2 rounded-xl border border-slate-200 px-3 text-sm font-semibold text-slate-700 transition hover:border-primary-300 hover:text-primary-700"
          >
            <PackagePlus className="h-4 w-4" /> New item
          </button>
        </div>

        <div className="mx-5 grid grid-cols-[minmax(0,1fr)_7rem_7rem_7rem_4.5rem_9.5rem] gap-2 rounded-t-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
          <span>Item</span>
          <span className="text-right">Stock</span>
          <span className="text-right">Sale price</span>
          <span className="text-right">Purchase</span>
          <span className="text-right">GST</span>
          <span className="text-center">Quantity</span>
        </div>

        <div ref={listRef} className="mx-5 flex-1 overflow-auto rounded-b-lg border-x border-b border-slate-200">
          {results.length === 0 && (
            <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
              <p className="text-sm font-semibold text-slate-700">No items match “{query}”</p>
              <button
                type="button"
                onClick={onCreateItem}
                className="text-sm font-semibold text-primary-700 hover:underline"
              >
                Create “{query || 'new item'}”
              </button>
            </div>
          )}
          {results.map((item, idx) => {
            const qty = selection[item.id] ?? 0;
            const isActive = idx === active;
            const noPrice = item.salesPrice <= 0;
            const belowCost = !noPrice && item.purchasePrice > 0 && item.salesPrice < item.purchasePrice;
            const isService = item.stock >= 9999;
            const negative = item.stock < 0;
            const low = !isService && !negative && item.stock <= item.lowStockAt;
            return (
              <div
                key={item.id}
                data-row={idx}
                onMouseEnter={() => setActive(idx)}
                onClick={() => qty === 0 && bump(item.id, 1)}
                className={clsx(
                  'relative grid cursor-pointer grid-cols-[minmax(0,1fr)_7rem_7rem_7rem_4.5rem_9.5rem] items-center gap-2 border-b border-slate-100 px-3 py-2.5 last:border-b-0',
                  qty > 0 ? 'bg-primary-50/70' : isActive ? 'bg-slate-50' : 'bg-white'
                )}
              >
                {isActive && <span className="absolute inset-y-0 left-0 w-1 bg-primary-500" />}
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-900">{item.name}</p>
                  <p className="flex flex-wrap items-center gap-x-2 text-[11px] text-slate-500">
                    <span className="font-mono">{item.code}</span>
                    <span>·</span>
                    <span>{item.category}</span>
                    <span>·</span>
                    <span>HSN {item.hsn}</span>
                    {inBill[item.id] ? (
                      <span className="rounded bg-primary-100 px-1.5 font-semibold text-primary-700">
                        {inBill[item.id]} in bill
                      </span>
                    ) : null}
                  </p>
                </div>
                <span
                  className={clsx(
                    'text-right text-sm font-medium tabular-nums',
                    negative ? 'text-rose-600' : low ? 'text-amber-600' : 'text-slate-700'
                  )}
                >
                  {isService ? '—' : `${item.stock} ${item.unit}`}
                  {(negative || low) && (
                    <span className="block text-[10px] font-semibold uppercase">{negative ? 'Negative' : 'Low'}</span>
                  )}
                </span>
                <span className="text-right text-sm font-semibold tabular-nums text-slate-900">
                  {noPrice ? (
                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-600">
                      <AlertTriangle className="h-3 w-3" /> No price
                    </span>
                  ) : (
                    <>
                      {inr(item.salesPrice, 0)}
                      {belowCost && (
                        <span className="block text-[10px] font-semibold uppercase text-rose-600">Below cost</span>
                      )}
                    </>
                  )}
                </span>
                <span className="text-right text-sm tabular-nums text-slate-400">
                  {item.purchasePrice ? inr(item.purchasePrice, 0) : '—'}
                </span>
                <span className="text-right text-xs font-medium text-slate-500">{item.gstPct}%</span>
                <div className="flex justify-center" onClick={(e) => e.stopPropagation()}>
                  {qty === 0 ? (
                    <button
                      type="button"
                      tabIndex={-1}
                      onClick={() => bump(item.id, 1)}
                      className="inline-flex h-8 items-center gap-1 rounded-lg border border-primary-200 bg-white px-4 text-xs font-bold text-primary-700 transition hover:border-primary-400 hover:bg-primary-50"
                    >
                      <Plus className="h-3.5 w-3.5" /> Add
                    </button>
                  ) : (
                    <div className="flex h-8 items-center overflow-hidden rounded-lg bg-primary-600 text-white shadow-sm shadow-primary-600/30">
                      <button
                        type="button"
                        tabIndex={-1}
                        onClick={() => bump(item.id, -1)}
                        className="flex h-full w-8 items-center justify-center hover:bg-primary-700"
                        aria-label="Decrease"
                      >
                        <Minus className="h-3.5 w-3.5" />
                      </button>
                      <input
                        data-qty-input="true"
                        value={qty}
                        inputMode="decimal"
                        onChange={(e) => setQty(item.id, Number(e.target.value) || 0)}
                        onFocus={(e) => e.target.select()}
                        className="h-6 w-11 rounded-md border-0 bg-white text-center text-sm font-bold tabular-nums text-primary-800 outline-none focus:ring-2 focus:ring-white/60"
                      />
                      <button
                        type="button"
                        tabIndex={-1}
                        onClick={() => bump(item.id, 1)}
                        className="flex h-full w-8 items-center justify-center hover:bg-primary-700"
                        aria-label="Increase"
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="mx-5 mt-2 flex items-center justify-between text-xs">
          <button
            type="button"
            onClick={() => setSelectedOnly((s) => !s)}
            disabled={!selectedEntries.length}
            className="font-semibold text-primary-700 hover:underline disabled:text-slate-400 disabled:no-underline"
          >
            {selectedOnly ? 'Show all items' : `Show ${selectedEntries.length} selected`}
          </button>
          <span className="tabular-nums text-slate-500">
            {selectedUnits} units · <span className="font-semibold text-slate-900">{inr(selectedValue)}</span> before tax
          </span>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-slate-100 bg-slate-50/60 px-5 py-3">
          <div className="hidden flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500 lg:flex">
            <span className="flex items-center gap-1">
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd> Move
            </span>
            <span className="flex items-center gap-1">
              <Kbd>Enter</Kbd> Add one
            </span>
            <span className="flex items-center gap-1">
              <Kbd>Shift</Kbd>+<Kbd>Enter</Kbd> Remove one
            </span>
            <span className="flex items-center gap-1">
              <Kbd>Esc</Kbd> Clear / close
            </span>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="h-10 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={commit}
              disabled={!selectedEntries.length}
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-primary-600 px-5 text-sm font-bold text-white shadow-lg shadow-primary-600/30 transition hover:bg-primary-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none"
            >
              Add {selectedEntries.length ? `${selectedEntries.length} ` : ''}to bill
              <Kbd className="border-white/30 bg-white/15 text-white">F7</Kbd>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
