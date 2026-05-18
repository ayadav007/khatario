'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Search, ScanLine, Plus, Minus, Loader2, ChevronDown } from 'lucide-react';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';

export type ItemLite = {
  id: string;
  name: string;
  code?: string;
  selling_price?: number;
  tax_rate?: number;
  hsn_sac?: string;
  unit?: string;
  gst_included?: boolean;
  current_stock?: number;
  has_variants?: boolean;
  variants?: any[];
  variantId?: string;
  variantName?: string;
  description?: string;
  _pickerNeedsVariant?: boolean;
};

function makeKey(item: ItemLite): string {
  return item.variantId ? `${item.id}::${item.variantId}` : `${item.id}::`;
}

const AVATAR_PALETTES = [
  'bg-violet-100 text-violet-800',
  'bg-emerald-100 text-emerald-800',
  'bg-amber-100 text-amber-900',
  'bg-sky-100 text-sky-800',
  'bg-rose-100 text-rose-800',
  'bg-fuchsia-100 text-fuchsia-800',
];

function avatarClass(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h + id.charCodeAt(i)) % AVATAR_PALETTES.length;
  return AVATAR_PALETTES[h];
}

/** Search API may return parent + variants JSON — flatten to one row per sellable line. */
function flattenSearchItems(raw: any[]): ItemLite[] {
  const rows: ItemLite[] = [];
  for (const item of raw) {
    const vars = item.variants;
    if (item.has_variants && Array.isArray(vars) && vars.length > 0) {
      for (const v of vars) {
        rows.push({
          ...item,
          variantId: v.id,
          variantName: v.variant_name,
          selling_price: v.selling_price ?? item.selling_price,
          current_stock: v.current_stock,
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

interface MobileItemPickerPanelProps {
  open: boolean;
  onClose: () => void;
  businessId: string;
  userId?: string;
  warehouseId?: string;
  branchId?: string;
  onApply: (selections: Array<{ item: ItemLite; quantity: number }>) => void;
  onCreateNewItem?: () => void;
  onOpenScanner?: () => void;
}

function QtyStepper({
  qty,
  onMinus,
  onPlus,
}: {
  qty: number;
  onMinus: () => void;
  onPlus: () => void;
}) {
  return (
    <div className="flex items-center gap-1.5 shrink-0">
      <button
        type="button"
        onClick={onMinus}
        disabled={qty <= 0}
        className="h-9 w-9 rounded-lg border border-border flex items-center justify-center text-text-primary disabled:opacity-40 bg-white"
        aria-label="Decrease quantity"
      >
        <Minus className="w-4 h-4" />
      </button>
      <span className="w-8 text-center text-sm font-semibold tabular-nums">{qty}</span>
      <button
        type="button"
        onClick={onPlus}
        className="h-9 w-9 rounded-lg border border-primary-500 text-primary-600 flex items-center justify-center bg-slate-50"
        aria-label="Increase quantity"
      >
        <Plus className="w-4 h-4" />
      </button>
    </div>
  );
}

function VariantSheet({
  open,
  parent,
  businessId,
  userId,
  warehouseId,
  quantities,
  onDelta,
  onClose,
}: {
  open: boolean;
  parent: ItemLite | null;
  businessId: string;
  userId?: string;
  warehouseId?: string;
  quantities: Record<string, number>;
  onDelta: (item: ItemLite, delta: number) => void;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [variants, setVariants] = useState<any[]>([]);

  useEffect(() => {
    if (!open || !parent?.id) return;
    let cancelled = false;
    setLoading(true);
    setVariants([]);
    const uid = userId ? `&user_id=${encodeURIComponent(userId)}` : '';
    const wh = warehouseId ? `&warehouse_id=${encodeURIComponent(warehouseId)}` : '';
    fetch(`/api/items/${parent.id}?business_id=${encodeURIComponent(businessId)}${uid}${wh}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        setVariants(Array.isArray(data.variants) ? data.variants : []);
      })
      .catch(() => setVariants([]))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, parent?.id, businessId, userId, warehouseId]);

  if (!open || !parent) return null;

  return (
    <div className="fixed inset-0 z-[10060] flex flex-col bg-background animate-in fade-in duration-150">
      <div className="flex items-center gap-2 px-3 py-3 border-b border-border bg-surface shrink-0">
        <button type="button" onClick={onClose} className="p-2 rounded-full hover:bg-gray-100" aria-label="Back">
          <ArrowLeft className="w-5 h-5 text-primary-600" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-text-primary truncate">{parent.name}</p>
          <p className="text-xs text-text-muted">Choose options</p>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        {loading && (
          <div className="flex justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
          </div>
        )}
        {!loading &&
          variants.map((v) => {
            const row: ItemLite = {
              ...parent,
              variantId: v.id,
              variantName: v.name || v.variant_name,
              selling_price: parseFloat(String(v.selling_price ?? parent.selling_price ?? 0)),
              current_stock: v.current_stock != null ? Number(v.current_stock) : parent.current_stock,
              has_variants: false,
              variants: [],
            };
            const k = makeKey(row);
            const q = quantities[k] || 0;
            return (
              <div
                key={v.id}
                className="flex items-center gap-3 py-3 border-b border-border last:border-0"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-text-primary text-sm">{row.variantName || 'Variant'}</p>
                  <p className="text-xs text-text-muted mt-0.5">
                    ₹ {Number(row.selling_price ?? 0).toLocaleString('en-IN', {
                      minimumFractionDigits: 0,
                      maximumFractionDigits: 2,
                    })}
                    /{row.unit || 'PCS'}
                  </p>
                  {row.current_stock != null && (
                    <p
                      className={`text-xs mt-0.5 ${Number(row.current_stock) < 0 ? 'text-red-600 font-medium' : 'text-text-muted'}`}
                    >
                      Stock: {row.current_stock} {row.unit || ''}
                    </p>
                  )}
                </div>
                <QtyStepper
                  qty={q}
                  onMinus={() => onDelta(row, -1)}
                  onPlus={() => onDelta(row, 1)}
                />
              </div>
            );
          })}
        {!loading && variants.length === 0 && (
          <p className="text-center text-text-muted text-sm py-8">No variants found for this item.</p>
        )}
      </div>
    </div>
  );
}

export function MobileItemPickerPanel({
  open,
  onClose,
  businessId,
  userId,
  warehouseId,
  branchId,
  onApply,
  onCreateNewItem,
  onOpenScanner,
}: MobileItemPickerPanelProps) {
  const [q, setQ] = useState('');
  const [browseLoading, setBrowseLoading] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [listRows, setListRows] = useState<ItemLite[]>([]);
  /** Single map: qty + item snapshot for apply */
  const [picked, setPicked] = useState<Record<string, { item: ItemLite; qty: number }>>({});
  const [variantParent, setVariantParent] = useState<ItemLite | null>(null);

  const resetState = useCallback(() => {
    setQ('');
    setListRows([]);
    setPicked({});
    setVariantParent(null);
  }, []);

  useEffect(() => {
    if (!open) {
      resetState();
      return;
    }
    if (!businessId || !userId) return;
    if (q.trim().length >= 1) return;
    let cancelled = false;
    setBrowseLoading(true);
    fetch(
      `/api/items?business_id=${encodeURIComponent(businessId)}&user_id=${encodeURIComponent(userId)}&limit=120&page=1`
    )
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        const raw = data.items || [];
        const mapped: ItemLite[] = raw.map((it: any) =>
          it.has_variants ? { ...it, _pickerNeedsVariant: true } : it
        );
        setListRows(mapped);
      })
      .catch(() => {
        if (!cancelled) setListRows([]);
      })
      .finally(() => {
        if (!cancelled) setBrowseLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, businessId, userId, resetState, q]);

  useEffect(() => {
    if (!open || !businessId) return;
    const trimmed = q.trim();
    if (trimmed.length < 1) return;
    const t = setTimeout(async () => {
      setSearchLoading(true);
      try {
        const uid = userId ? `&user_id=${encodeURIComponent(userId)}` : '';
        const wh = warehouseId ? `&warehouse_id=${encodeURIComponent(warehouseId)}` : '';
        const br =
          branchId && branchId !== 'ALL' ? `&branch_id=${encodeURIComponent(branchId)}` : '';
        const res = await fetch(
          `/api/items/search?business_id=${encodeURIComponent(businessId)}&q=${encodeURIComponent(trimmed)}&limit=80${uid}${wh}${br}`
        );
        if (res.ok) {
          const data = await res.json();
          const flat = flattenSearchItems(data.items || []);
          setListRows(flat);
        } else setListRows([]);
      } catch {
        setListRows([]);
      } finally {
        setSearchLoading(false);
      }
    }, 280);
    return () => clearTimeout(t);
  }, [open, q, businessId, userId, warehouseId, branchId]);

  const changeQty = useCallback((item: ItemLite, delta: number) => {
    const key = makeKey(item);
    setPicked((prev) => {
      const cur = prev[key]?.qty ?? 0;
      const next = Math.max(0, cur + delta);
      if (next === 0) {
        const { [key]: _, ...rest } = prev;
        return rest;
      }
      return { ...prev, [key]: { item: { ...item }, qty: next } };
    });
  }, []);

  const quantityMap = useMemo(() => {
    const m: Record<string, number> = {};
    for (const [k, v] of Object.entries(picked)) m[k] = v.qty;
    return m;
  }, [picked]);

  const totalPicked = useMemo(
    () => Object.values(picked).reduce((a, b) => a + b.qty, 0),
    [picked]
  );

  const handleDone = useCallback(() => {
    const selections = Object.values(picked)
      .filter((l) => l.qty > 0)
      .map((l) => ({ item: l.item, quantity: l.qty }));
    if (selections.length === 0) {
      onClose();
      return;
    }
    onApply(selections);
  }, [picked, onApply, onClose]);

  const loading = browseLoading || searchLoading;

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-[10050] flex flex-col bg-background">
        <div className="flex items-center gap-2 px-2 sm:px-3 pt-[max(12px,env(safe-area-inset-top))] pb-3 border-b border-border bg-surface shrink-0">
          <button type="button" onClick={onClose} className="p-2 rounded-full hover:bg-gray-100 shrink-0" aria-label="Back">
            <ArrowLeft className="w-5 h-5 text-primary-600" />
          </button>
          <div className="flex-1 relative min-w-0">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search by name, code, barcode…"
              className="pl-10 h-11 bg-slate-50/40 border-primary-100"
              autoFocus
            />
          </div>
          {onOpenScanner && (
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenScanner();
              }}
              className="p-2.5 rounded-xl border border-border bg-white shrink-0"
              aria-label="Scan barcode"
            >
              <ScanLine className="w-5 h-5 text-primary-600" />
            </button>
          )}
        </div>

        {onCreateNewItem && (
          <div className="px-3 pb-2 flex justify-end shrink-0">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="rounded-full"
              onClick={() => {
                onClose();
                onCreateNewItem();
              }}
            >
              <Plus className="w-4 h-4 mr-1" />
              Create new item
            </Button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto min-h-0">
          {loading && listRows.length === 0 && (
            <div className="flex justify-center py-16 text-gray-500">
              <Loader2 className="w-8 h-8 animate-spin" />
            </div>
          )}
          {!loading && q.trim().length === 0 && !userId && (
            <p className="text-center text-gray-500 text-sm py-12 px-4">Sign in to load items.</p>
          )}
          <ul className="divide-y divide-border">
            {listRows.map((item) => {
              const k = makeKey(item);
              const qty = picked[k]?.qty ?? 0;
              const letter = (item.name || '?').trim().charAt(0).toUpperCase();
              const price = Number(item.selling_price ?? 0);
              const unit = item.unit || 'PCS';
              const stock = item.current_stock;
              const needsVariant = item._pickerNeedsVariant;

              return (
                <li key={k} className="flex items-start gap-3 px-3 py-3 bg-white">
                  <div
                    className={`w-11 h-11 rounded-xl flex items-center justify-center text-sm font-bold shrink-0 ${avatarClass(item.id)}`}
                  >
                    {letter}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-text-primary text-[15px] leading-snug">{item.name}</p>
                    {item.code && item.code !== item.name && (
                      <p className="text-xs text-text-muted mt-0.5">{item.code}</p>
                    )}
                    <div className="flex items-center gap-1 mt-1 text-sm text-text-secondary">
                      <span>
                        ₹ {price.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}/{unit}
                      </span>
                      <ChevronDown className="w-3.5 h-3.5 text-primary-500 opacity-70" aria-hidden />
                    </div>
                    {stock != null && (
                      <p
                        className={`text-xs mt-0.5 ${Number(stock) < 0 ? 'text-red-600 font-medium' : 'text-text-muted'}`}
                      >
                        Stock: {stock} {unit}
                      </p>
                    )}
                  </div>
                  <div className="shrink-0 pt-0.5">
                    {needsVariant ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        className="whitespace-nowrap"
                        onClick={() => setVariantParent(item)}
                      >
                        Choose
                      </Button>
                    ) : qty === 0 ? (
                      <button
                        type="button"
                        onClick={() => changeQty(item, 1)}
                        className="px-3 py-2 rounded-lg border-2 border-primary-500 text-primary-600 text-sm font-semibold bg-white"
                      >
                        ADD +
                      </button>
                    ) : (
                      <QtyStepper
                        qty={qty}
                        onMinus={() => changeQty(item, -1)}
                        onPlus={() => changeQty(item, 1)}
                      />
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          {!loading && listRows.length === 0 && userId && (
            <p className="text-center text-gray-500 text-sm py-12 px-4">
              {q.trim() ? 'No items match your search.' : 'No items to show.'}
            </p>
          )}
        </div>

        <div className="shrink-0 border-t border-border bg-surface px-3 py-3 pb-[max(12px,env(safe-area-inset-bottom))] space-y-2">
          <Button
            type="button"
            variant="primary"
            className="w-full h-12 font-semibold"
            onClick={handleDone}
            disabled={totalPicked === 0}
          >
            {totalPicked === 0 ? 'Add to invoice' : `Add to invoice · ${totalPicked} pcs`}
          </Button>
          <p className="text-[11px] text-center text-text-muted">Adjust quantities above, then confirm here.</p>
        </div>
      </div>

      <VariantSheet
        open={!!variantParent}
        parent={variantParent}
        businessId={businessId}
        userId={userId}
        warehouseId={warehouseId}
        quantities={quantityMap}
        onDelta={changeQty}
        onClose={() => setVariantParent(null)}
      />
    </>
  );
}
