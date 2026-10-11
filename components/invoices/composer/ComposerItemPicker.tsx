'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { clsx } from 'clsx';
import { AlertTriangle, ChevronRight, Loader2, Minus, PackagePlus, Plus, Search, X } from 'lucide-react';
import { browseOfflineItems, searchOfflineItems } from '@/lib/offline/catalog/client-search';
import { rowKey, type PickerItem } from './types';
import { inr, Kbd } from './ui';

type Props = {
  open: boolean;
  initialQuery: string;
  businessId: string;
  userId?: string;
  warehouseId?: string;
  branchId?: string;
  inBill: Record<string, number>;
  onClose: () => void;
  onApply: (selections: Array<{ item: PickerItem; quantity: number }>) => void;
  onCreateItem: () => void;
};

const keyOf = (item: PickerItem) => rowKey(String(item.id), item.variantId ? String(item.variantId) : null);

/** Profit kept on one unit, before GST. GST on the sale is not income, and purchase price is stored without GST. */
function unitProfit(item: PickerItem): number | null {
  const sale = Number(item.selling_price || 0);
  const cost = Number(item.purchase_price || 0);
  if (!(sale > 0) || !(cost > 0)) return null;
  const rate = Number(item.tax_rate || 0);
  const taxableSale = item.gst_included && rate > 0 ? (sale * 100) / (100 + rate) : sale;
  return Math.round((taxableSale - cost) * 100) / 100;
}

function flatten(raw: any[]): PickerItem[] {
  const rows: PickerItem[] = [];
  for (const item of raw) {
    const vars = item.variants;
    if (item.has_variants && Array.isArray(vars) && vars.length > 0) {
      for (const v of vars) {
        rows.push({
          ...item,
          variantId: v.id,
          variantName: v.variant_name || v.name,
          selling_price: v.selling_price ?? item.selling_price,
          current_stock: v.current_stock ?? item.current_stock,
          has_variants: false,
          variants: [],
        });
      }
    } else if (item.has_variants) {
      rows.push({ ...item, _pickerNeedsVariant: true });
    } else {
      rows.push(item);
    }
  }
  return rows;
}

export function ItemPickerModal({
  open,
  initialQuery,
  businessId,
  userId,
  warehouseId,
  branchId,
  inBill,
  onClose,
  onApply,
  onCreateItem,
}: Props) {
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<PickerItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const [picked, setPicked] = useState<Record<string, { item: PickerItem; qty: number }>>({});
  const [selectedOnly, setSelectedOnly] = useState(false);
  const [expanding, setExpanding] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery(initialQuery);
    setActive(0);
    setPicked({});
    setSelectedOnly(false);
    requestAnimationFrame(() => {
      const el = searchRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });
  }, [open, initialQuery]);

  useEffect(() => {
    if (!open || !businessId) return;
    const q = query.trim();
    let cancelled = false;
    setLoading(true);
    const run = async () => {
      try {
        const scope = { businessId, userId: userId || '' };
        if (!q) {
          const offline = userId ? await browseOfflineItems(scope, { warehouseId, branchId, limit: 150 }) : null;
          if (cancelled) return;
          if (offline != null) {
            setItems(offline.map((it: any) => (it.has_variants ? { ...it, _pickerNeedsVariant: true } : it)));
            return;
          }
          const res = await fetch(
            `/api/items?business_id=${encodeURIComponent(businessId)}${userId ? `&user_id=${encodeURIComponent(userId)}` : ''}&limit=150&page=1`
          );
          const data = res.ok ? await res.json() : { items: [] };
          if (!cancelled) setItems((data.items || []).map((it: any) => (it.has_variants ? { ...it, _pickerNeedsVariant: true } : it)));
          return;
        }
        const offline = userId ? await searchOfflineItems(scope, q, { warehouseId, branchId, limit: 80 }) : null;
        if (cancelled) return;
        if (offline != null) {
          setItems(flatten(offline));
          return;
        }
        const params = new URLSearchParams({ business_id: businessId, q, limit: '80' });
        if (userId) params.set('user_id', userId);
        if (warehouseId) params.set('warehouse_id', warehouseId);
        if (branchId && branchId !== 'ALL') params.set('branch_id', branchId);
        const res = await fetch(`/api/items/search?${params.toString()}`);
        const data = res.ok ? await res.json() : { items: [] };
        if (!cancelled) setItems(flatten(data.items || []));
      } catch {
        if (!cancelled) setItems([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    const t = setTimeout(run, q ? 220 : 0);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [open, query, businessId, userId, warehouseId, branchId]);

  const selectedEntries = useMemo(() => Object.values(picked).filter((p) => p.qty > 0), [picked]);
  const results = useMemo(
    () => (selectedOnly ? selectedEntries.map((p) => p.item) : items),
    [selectedOnly, selectedEntries, items]
  );

  useEffect(() => setActive(0), [query, selectedOnly]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-row="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const setQty = useCallback((item: PickerItem, qty: number) => {
    const k = keyOf(item);
    setPicked((prev) => {
      if (qty <= 0) {
        const { [k]: _removed, ...rest } = prev;
        return rest;
      }
      return { ...prev, [k]: { item, qty } };
    });
  }, []);

  const bump = (item: PickerItem, delta: number) => setQty(item, (picked[keyOf(item)]?.qty ?? 0) + delta);

  const expandVariants = async (parent: PickerItem) => {
    setExpanding(String(parent.id));
    try {
      const params = new URLSearchParams({ business_id: businessId });
      if (userId) params.set('user_id', userId);
      if (warehouseId) params.set('warehouse_id', warehouseId);
      const res = await fetch(`/api/items/${parent.id}?${params.toString()}`);
      const data = res.ok ? await res.json() : {};
      const variants: any[] = Array.isArray(data.variants) ? data.variants : [];
      const rows: PickerItem[] = variants.map((v) => ({
        ...parent,
        variantId: v.id,
        variantName: v.name || v.variant_name,
        selling_price: Number(v.selling_price ?? parent.selling_price ?? 0),
        current_stock: v.current_stock != null ? Number(v.current_stock) : parent.current_stock,
        has_variants: false,
        variants: [],
        _pickerNeedsVariant: false,
      }));
      setItems((prev) => {
        const idx = prev.findIndex((p) => p.id === parent.id && p._pickerNeedsVariant);
        if (idx < 0) return prev;
        return [...prev.slice(0, idx), ...rows, ...prev.slice(idx + 1)];
      });
    } finally {
      setExpanding(null);
    }
  };

  const commit = () => {
    if (!selectedEntries.length) return;
    onApply(selectedEntries.map((p) => ({ item: p.item, quantity: p.qty })));
  };
  const commitRef = useRef(commit);
  commitRef.current = commit;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      const add = e.key === 'F7' || e.code === 'F7' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey));
      if (!add) return;
      e.preventDefault();
      e.stopPropagation();
      commitRef.current();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open]);

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
      if (!item) return;
      if (item._pickerNeedsVariant) void expandVariants(item);
      else bump(item, e.shiftKey ? -1 : 1);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (inQtyInput) searchRef.current?.focus();
      else if (query) setQuery('');
      else onClose();
    }
  };

  if (!open) return null;

  const selectedUnits = selectedEntries.reduce((s, p) => s + p.qty, 0);
  const selectedValue = selectedEntries.reduce((s, p) => s + Number(p.item.selling_price || 0) * p.qty, 0);
  const showPurchase = items.some((i) => Number(i.purchase_price) > 0);
  const cols = showPurchase
    ? 'grid-cols-[minmax(0,1fr)_6.5rem_6.5rem_6.5rem_6.5rem_3.5rem_9.5rem]'
    : 'grid-cols-[minmax(0,1fr)_7rem_7rem_4.5rem_9.5rem]';

  return (
    <div
      className="fixed inset-0 z-[90] flex items-start justify-center bg-slate-900/50 p-4 pt-[6vh] backdrop-blur-sm"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Add items"
        onKeyDown={onKeyDown}
        className="flex h-[84vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-surface shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
          <div>
            <h2 className="text-base font-bold text-text-primary">Add items</h2>
            <p className="text-xs text-text-secondary">Select several items with quantities, then add them together</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-text-muted hover:bg-slate-100 hover:text-text-primary dark:hover:bg-slate-800"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 px-5 py-3">
          <div className="flex h-11 min-w-[260px] flex-1 items-center gap-2 rounded-xl border-2 border-primary-500 bg-surface px-3 ring-4 ring-primary-100 dark:ring-primary-900/40">
            <Search className="h-4 w-4 shrink-0 text-primary-600" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by item name, code or barcode"
              autoComplete="off"
              className="min-w-0 flex-1 bg-transparent text-sm font-medium text-text-primary outline-none placeholder:font-normal placeholder:text-text-muted"
            />
            {loading && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-text-muted" />}
          </div>
          <button
            type="button"
            onClick={onCreateItem}
            className="inline-flex h-11 items-center gap-2 rounded-xl border border-border px-3 text-sm font-semibold text-text-secondary transition hover:border-primary-300 hover:text-primary-700"
          >
            <PackagePlus className="h-4 w-4" /> New item
          </button>
        </div>

        <div
          className={clsx(
            'mx-5 grid gap-2 rounded-t-lg border border-border bg-slate-50 px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-text-secondary dark:bg-slate-800/60',
            cols
          )}
        >
          <span>Item</span>
          <span className="text-right">Stock</span>
          <span className="text-right">Sale price</span>
          {showPurchase && <span className="text-right">Purchase</span>}
          {showPurchase && <span className="text-right">Profit</span>}
          <span className="text-right">GST</span>
          <span className="text-center">Quantity</span>
        </div>

        <div ref={listRef} className="mx-5 flex-1 overflow-auto rounded-b-lg border-x border-b border-border">
          {!loading && results.length === 0 && (
            <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
              <p className="text-sm font-semibold text-text-primary">
                {query.trim() ? `No items match “${query.trim()}”` : 'No items yet'}
              </p>
              <button type="button" onClick={onCreateItem} className="text-sm font-semibold text-primary-700 hover:underline">
                Create {query.trim() ? `“${query.trim()}”` : 'a new item'}
              </button>
            </div>
          )}
          {results.map((item, idx) => {
            const k = keyOf(item);
            const qty = picked[k]?.qty ?? 0;
            const isActive = idx === active;
            const price = Number(item.selling_price || 0);
            const cost = Number(item.purchase_price || 0);
            const profit = unitProfit(item);
            const noPrice = price <= 0;
            const belowCost = profit != null && profit < 0;
            const stock = item.current_stock;
            const hasStock = stock !== undefined && stock !== null;
            const negative = hasStock && Number(stock) < 0;
            const low = hasStock && !negative && item.low_stock_threshold != null && Number(stock) <= Number(item.low_stock_threshold);
            const already = inBill[k];
            const needsVariant = !!item._pickerNeedsVariant;
            const label = item.variantName ? `${item.name} · ${item.variantName}` : item.name;
            return (
              <div
                key={`${k}:${idx}`}
                data-row={idx}
                onMouseEnter={() => setActive(idx)}
                onClick={() => {
                  if (needsVariant) void expandVariants(item);
                  else if (qty === 0) bump(item, 1);
                }}
                className={clsx(
                  'relative grid cursor-pointer items-center gap-2 border-b border-border/70 px-3 py-2.5 last:border-b-0',
                  cols,
                  qty > 0 ? 'bg-primary-50/70 dark:bg-primary-900/20' : isActive ? 'bg-slate-50 dark:bg-slate-800/50' : 'bg-surface'
                )}
              >
                {isActive && <span className="absolute inset-y-0 left-0 w-1 bg-primary-500" />}
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-text-primary" title={label}>
                    {label}
                  </p>
                  <p className="flex flex-wrap items-center gap-x-2 text-[11px] text-text-secondary">
                    {item.code && <span className="font-mono">{item.code}</span>}
                    {item.hsn_sac && <span>HSN {item.hsn_sac}</span>}
                    {item.unit && <span>{item.unit}</span>}
                    {already ? (
                      <span className="rounded bg-primary-100 px-1.5 font-semibold text-primary-700 dark:bg-primary-900/40 dark:text-primary-300">
                        {already} in bill
                      </span>
                    ) : null}
                  </p>
                </div>
                <span
                  className={clsx(
                    'text-right text-sm font-medium tabular-nums',
                    negative ? 'text-rose-600' : low ? 'text-amber-600' : 'text-text-primary'
                  )}
                >
                  {hasStock && !needsVariant ? `${stock}` : '—'}
                  {(negative || low) && (
                    <span className="block text-[10px] font-semibold uppercase">{negative ? 'Negative' : 'Low'}</span>
                  )}
                </span>
                <span className="text-right text-sm font-semibold tabular-nums text-text-primary">
                  {noPrice ? (
                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-600">
                      <AlertTriangle className="h-3 w-3" /> No price
                    </span>
                  ) : (
                    <>
                      {inr(price, price % 1 ? 2 : 0)}
                      {belowCost && <span className="block text-[10px] font-semibold uppercase text-rose-600">Below cost</span>}
                    </>
                  )}
                </span>
                {showPurchase && (
                  <span className="text-right text-sm tabular-nums text-text-muted">{cost ? inr(cost, cost % 1 ? 2 : 0) : '—'}</span>
                )}
                {showPurchase && (
                  <span
                    className={clsx(
                      'text-right text-sm font-semibold tabular-nums',
                      profit == null ? 'text-text-muted' : profit < 0 ? 'text-rose-600' : 'text-emerald-700'
                    )}
                  >
                    {profit == null ? '—' : inr(profit, profit % 1 ? 2 : 0)}
                  </span>
                )}
                <span className="text-right text-xs font-medium text-text-secondary">{Number(item.tax_rate || 0)}%</span>
                <div className="flex justify-center" onClick={(e) => e.stopPropagation()}>
                  {needsVariant ? (
                    <button
                      type="button"
                      tabIndex={-1}
                      onClick={() => void expandVariants(item)}
                      className="inline-flex h-8 items-center gap-1 rounded-lg border border-border bg-surface px-3 text-xs font-bold text-text-secondary transition hover:border-primary-400 hover:text-primary-700"
                    >
                      {expanding === String(item.id) ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                      Variants <ChevronRight className="h-3.5 w-3.5" />
                    </button>
                  ) : qty === 0 ? (
                    <button
                      type="button"
                      tabIndex={-1}
                      onClick={() => bump(item, 1)}
                      className="inline-flex h-8 items-center gap-1 rounded-lg border border-primary-200 bg-surface px-4 text-xs font-bold text-primary-700 transition hover:border-primary-400 hover:bg-primary-50"
                    >
                      <Plus className="h-3.5 w-3.5" /> Add
                    </button>
                  ) : (
                    <div className="flex h-8 items-center overflow-hidden rounded-lg bg-primary-600 text-white shadow-sm shadow-primary-600/30">
                      <button
                        type="button"
                        tabIndex={-1}
                        onClick={() => bump(item, -1)}
                        className="flex h-full w-8 items-center justify-center hover:bg-primary-700"
                        aria-label="Decrease"
                      >
                        <Minus className="h-3.5 w-3.5" />
                      </button>
                      <input
                        data-qty-input="true"
                        value={qty}
                        inputMode="decimal"
                        onChange={(e) => setQty(item, Number(e.target.value.replace(/[^0-9.]/g, '')) || 0)}
                        onFocus={(e) => e.target.select()}
                        className="h-6 w-11 rounded-md border-0 bg-white text-center text-sm font-bold tabular-nums text-primary-800 outline-none focus:ring-2 focus:ring-white/60"
                      />
                      <button
                        type="button"
                        tabIndex={-1}
                        onClick={() => bump(item, 1)}
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
            className="font-semibold text-primary-700 hover:underline disabled:text-text-muted disabled:no-underline"
          >
            {selectedOnly ? 'Show all items' : `Show ${selectedEntries.length} selected`}
          </button>
          <span className="tabular-nums text-text-secondary">
            {selectedUnits} units · <span className="font-semibold text-text-primary">{inr(selectedValue)}</span> at list price
          </span>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border bg-slate-50/60 px-5 py-3 dark:bg-slate-800/40">
          <div className="hidden flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-text-secondary lg:flex">
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
              className="h-10 rounded-xl border border-border bg-surface px-4 text-sm font-semibold text-text-secondary hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={commit}
              disabled={!selectedEntries.length}
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-primary-600 px-5 text-sm font-bold text-white shadow-lg shadow-primary-600/30 transition hover:bg-primary-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none dark:disabled:bg-slate-700"
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
