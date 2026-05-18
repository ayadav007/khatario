'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, Camera, Loader2, Search } from 'lucide-react';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { BarcodeScanner } from '@/components/ui/BarcodeScanner';
import { normalizeBarcode } from '@/lib/barcode-validator';
import { PURCHASE_ITEM_PICK_RESULT_KEY } from '@/lib/purchase-scan-constants';

type ItemRow = {
  id: string;
  name: string;
  unit: string;
  barcode?: string;
  selling_price: number | null;
  purchase_price?: number;
  tax_rate: number;
  current_stock: number;
  item_type?: 'goods' | 'service';
  image_url?: string;
  has_variants?: boolean;
  is_bundle?: boolean;
  variants?: Array<{
    id: string;
    variant_name: string;
    selling_price?: number | null;
    current_stock: number;
    sku?: string;
    barcode?: string;
    attributes?: Record<string, unknown>;
  }>;
};

function avatarHue(name: string): string {
  const hues = [
    'bg-sky-100 text-sky-800',
    'bg-emerald-100 text-emerald-800',
    'bg-violet-100 text-violet-800',
    'bg-amber-100 text-amber-900',
    'bg-rose-100 text-rose-800',
  ];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h + name.charCodeAt(i) * 13) % 1000;
  return hues[h % hues.length];
}

export function PurchaseItemPickerScreen() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { business, user } = useAuth();

  const kind = searchParams.get('kind') === 'service' ? 'service' : 'goods';
  const returnTo = searchParams.get('returnTo') || '/purchases/new';
  const warehouseId = searchParams.get('warehouse_id') || '';

  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<ItemRow[]>([]);
  const [showScanner, setShowScanner] = useState(false);

  const [variantPicker, setVariantPicker] = useState<ItemRow | null>(null);

  const itemTypeParam = kind === 'service' ? 'service' : 'goods';

  const fetchList = useCallback(async () => {
    if (!business?.id) return;
    setLoading(true);
    try {
      const trimmed = q.trim();
      const wh = warehouseId ? `&warehouse_id=${encodeURIComponent(warehouseId)}` : '';
      let url: string;
      if (trimmed.length >= 1) {
        url = `/api/items/search?business_id=${business.id}&q=${encodeURIComponent(trimmed)}&limit=80${wh}`;
      } else {
        url = `/api/items/search?business_id=${business.id}&browse=1&item_type=${itemTypeParam}&limit=80${wh}`;
      }
      const res = await fetch(url);
      const data = await res.json();
      setItems(Array.isArray(data.items) ? data.items : []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [business?.id, q, warehouseId, itemTypeParam]);

  useEffect(() => {
    const t = setTimeout(() => {
      void fetchList();
    }, q.trim().length >= 1 ? 280 : 0);
    return () => clearTimeout(t);
  }, [fetchList, q]);

  const returnHref = useMemo(() => {
    try {
      return decodeURIComponent(returnTo);
    } catch {
      return returnTo;
    }
  }, [returnTo]);

  const pickItem = (raw: ItemRow, variant?: NonNullable<ItemRow['variants']>[number]) => {
    const row: Record<string, unknown> = { ...raw };
    if (variant) {
      row.selling_price = variant.selling_price ?? raw.selling_price;
      row.current_stock = variant.current_stock;
      row.name = `${raw.name} — ${variant.variant_name}`;
      (row as { variantId?: string }).variantId = variant.id;
    }
    sessionStorage.setItem(PURCHASE_ITEM_PICK_RESULT_KEY, JSON.stringify({ item: row }));
    router.replace(returnHref);
  };

  const onAddClick = (it: ItemRow) => {
    if (it.has_variants && Array.isArray(it.variants) && it.variants.length > 0) {
      setVariantPicker(it);
      return;
    }
    pickItem(it);
  };

  const handleBarcodeScan = async (text: string) => {
    setShowScanner(false);
    const code = normalizeBarcode(text);
    if (!code || !business?.id) return;
    setQ(code);
    setLoading(true);
    try {
      const wh = warehouseId ? `&warehouse_id=${encodeURIComponent(warehouseId)}` : '';
      const res = await fetch(
        `/api/items/search?business_id=${business.id}&q=${encodeURIComponent(code)}&limit=20${wh}`,
      );
      const data = await res.json();
      const found: ItemRow[] = Array.isArray(data.items) ? data.items : [];
      if (found.length === 1) {
        onAddClick(found[0]);
        return;
      }
      if (found.length > 0) {
        const exact = found.find(
          (i) => i.barcode && normalizeBarcode(String(i.barcode)) === code,
        );
        if (exact) {
          onAddClick(exact);
          return;
        }
      }
      setItems(found);
    } finally {
      setLoading(false);
    }
  };

  if (!user?.id || !business?.id) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-sm text-text-secondary">
        Sign in to search items.
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="sticky top-0 z-20 flex items-center gap-2 border-b border-border bg-surface px-3 py-2 shadow-sm">
        <button
          type="button"
          onClick={() => router.push(returnHref)}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-text-secondary hover:bg-slate-100 dark:hover:bg-slate-800"
          aria-label="Back"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
            <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={
              kind === 'service'
                ? 'Search services by name or code…'
                : 'Search goods by name, code, or barcode…'
            }
            className="focus-primary w-full rounded-lg border border-border bg-white py-2 pl-9 pr-20 text-sm text-text-primary outline-none ring-0 dark:bg-slate-900"
          />
          <div className="absolute right-2 top-1/2 flex -translate-y-1/2 gap-1">
            <button
              type="button"
              className="flex h-8 w-8 items-center justify-center rounded-md text-text-secondary hover:bg-slate-100 dark:hover:bg-slate-800"
              aria-label="Scan barcode"
              onClick={() => setShowScanner(true)}
            >
              <Camera className="h-5 w-5" />
            </button>
          </div>
        </div>
      </header>

      <div className="flex justify-end border-b border-border bg-surface px-3 py-2">
        <Link
          href={`/items/new?returnTo=${encodeURIComponent('/purchases/new/select-item?' + searchParams.toString())}`}
          className="rounded-full border border-border bg-white px-3 py-1.5 text-xs font-medium text-text-primary dark:bg-slate-900"
        >
          + Create new item
        </Link>
      </div>

      <div className="flex-1 overflow-auto pb-safe">
        {loading && items.length === 0 && (
          <div className="flex justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-text-muted" />
          </div>
        )}
        <ul className="divide-y divide-border">
          {items.map((it) => {
            const letter = (it.name || '?').trim().charAt(0).toUpperCase();
            const rate = it.purchase_price != null && it.purchase_price > 0 ? it.purchase_price : it.selling_price;
            const rateLabel =
              rate != null && Number.isFinite(Number(rate)) ? `₹ ${Number(rate).toLocaleString('en-IN')}` : '—';
            return (
              <li key={it.id} className="flex items-start gap-3 bg-surface px-3 py-2.5">
                <div
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-sm font-bold ${avatarHue(it.name || '')}`}
                >
                  {letter}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-medium leading-snug text-text-primary">{it.name}</div>
                  <div className="mt-0.5 text-xs text-text-secondary">
                    {rateLabel}
                    {it.unit ? ` / ${it.unit}` : ''}
                  </div>
                  <div className="mt-0.5 text-[11px] text-text-muted">
                    Stock: {Number(it.current_stock || 0).toLocaleString('en-IN')}
                    {it.unit ? it.unit : ''}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onAddClick(it)}
                  className="shrink-0 rounded-lg border border-border bg-white px-2.5 py-1.5 text-xs font-semibold text-text-primary shadow-sm dark:bg-slate-900"
                >
                  Add +
                </button>
              </li>
            );
          })}
        </ul>
        {!loading && items.length === 0 && (
          <p className="px-4 py-10 text-center text-sm text-text-secondary">
            {q.trim().length >= 1 ? 'No matching items.' : 'No items in catalogue for this filter.'}
          </p>
        )}
      </div>

      {showScanner && (
        <BarcodeScanner
          onScan={(text) => void handleBarcodeScan(text)}
          onClose={() => setShowScanner(false)}
        />
      )}

      {variantPicker && variantPicker.variants && variantPicker.variants.length > 0 && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Choose variant"
        >
          <div className="max-h-[70vh] w-full overflow-auto rounded-t-xl border border-border bg-white p-4 shadow-lg sm:max-w-md sm:rounded-xl dark:bg-slate-900">
            <div className="mb-3 text-sm font-semibold text-text-primary">{variantPicker.name}</div>
            <ul className="space-y-2">
              {variantPicker.variants.map((v) => (
                <li key={v.id}>
                  <button
                    type="button"
                    className="w-full rounded-lg border border-border px-3 py-2.5 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-800"
                    onClick={() => {
                      pickItem(variantPicker, v);
                      setVariantPicker(null);
                    }}
                  >
                    <span className="font-medium">{v.variant_name}</span>
                    <span className="ml-2 text-text-muted">
                      Stock {Number(v.current_stock || 0)} ·{' '}
                      {v.selling_price != null ? `₹${v.selling_price}` : ''}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              className="mt-3 w-full rounded-lg border border-border py-2 text-sm text-text-secondary"
              onClick={() => setVariantPicker(null)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
