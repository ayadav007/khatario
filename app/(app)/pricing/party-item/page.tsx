'use client';

export const dynamic = 'force-dynamic';

import { PageHeader } from '@/components/layout/PageHeader';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Loader2, Save } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Breadcrumbs } from '@/components/navigation/Breadcrumbs';
import { useAuth } from '@/contexts/AuthContext';
import { useToastContext } from '@/contexts/ToastContext';
import { useAuthorizationGuard } from '@/hooks/useAuthorizationGuard';
import { AccessDenied } from '@/components/common/AccessDenied';
import { Item, Customer } from '@/types/database';
import { csvToRateRows, downloadText, parseCsv, toCsv } from '@/lib/pricing/rate-csv';

function formatInr(n: number): string {
  if (!Number.isFinite(n)) return '₹—';
  return `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Prices are keyed by item, or by item + variant for a price that covers one variant only. */
function priceKey(itemId: string, variantId?: string | null): string {
  return variantId ? `${itemId}::${variantId}` : itemId;
}

function splitPriceKey(key: string): { item_id: string; variant_id: string | null } {
  const [itemId, variantId] = key.split('::');
  return { item_id: itemId, variant_id: variantId || null };
}

interface VariantOption {
  id: string;
  item_id: string;
  variant_name: string;
  selling_price: number | null;
}

/** One row on screen: a whole item, or one variant of it. */
interface PriceRow {
  key: string;
  item: Item;
  variant?: VariantOption;
}

interface SavedRate {
  price: number | null;
  discount_percent: number | null;
  valid_from: string | null;
  valid_to: string | null;
}

/** What the user is typing for a row; '' means not set. */
interface Draft {
  price: string;
  discount: string;
  from: string;
  to: string;
}

const EMPTY_DRAFT: Draft = { price: '', discount: '', from: '', to: '' };

const toDraft = (r: SavedRate | undefined): Draft =>
  r
    ? {
        price: r.price == null ? '' : String(r.price),
        discount: r.discount_percent == null ? '' : String(r.discount_percent),
        from: r.valid_from ?? '',
        to: r.valid_to ?? '',
      }
    : EMPTY_DRAFT;

/** Parse a draft: null fields mean not set; 'invalid' when a number or the dates are wrong. */
function parseDraft(d: Draft): SavedRate | 'invalid' {
  const num = (t: string, max?: number) => {
    const s = t.trim();
    if (s === '') return null;
    const n = parseFloat(s);
    if (!Number.isFinite(n) || n < 0 || (max != null && n > max)) return 'invalid' as const;
    return Math.round(n * 100) / 100;
  };
  const price = num(d.price);
  const discount = num(d.discount, 100);
  if (price === 'invalid' || discount === 'invalid') return 'invalid';
  if (d.from && d.to && d.from > d.to) return 'invalid';
  return { price, discount_percent: discount, valid_from: d.from || null, valid_to: d.to || null };
}

function draftIsDirty(d: Draft | undefined, saved: SavedRate | undefined): boolean {
  const a = JSON.stringify(toDraft(saved));
  const b = JSON.stringify(d ?? EMPTY_DRAFT);
  if (a === b) return false;
  const p = parseDraft(d ?? EMPTY_DRAFT);
  if (p === 'invalid') return true;
  const s = saved ?? { price: null, discount_percent: null, valid_from: null, valid_to: null };
  return JSON.stringify(p) !== JSON.stringify(s);
}

type Tab = 'items' | 'categories' | 'history';

interface HistoryRow {
  id: string;
  scope: string;
  changed_at: string;
  item_name: string | null;
  variant_name: string | null;
  category_name: string | null;
  old_price: number | null;
  new_price: number | null;
  old_discount_percent: number | null;
  new_discount_percent: number | null;
  valid_from: string | null;
  valid_to: string | null;
  changed_by_name: string | null;
}

const rateText = (price: number | null, disc: number | null) => {
  const parts = [];
  if (price != null) parts.push(formatInr(price));
  if (disc != null) parts.push(`${disc}% off`);
  return parts.length ? parts.join(' · ') : 'none';
};

export default function PartyItemPricingPage() {
  const { business, user } = useAuth();
  const toast = useToastContext();

  const { allowed: canEdit, reason } = useAuthorizationGuard({
    resource: 'items',
    action: 'update',
    skipCheck: !user?.id || !business?.id,
  });

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [levels, setLevels] = useState<Array<{ id: string; name: string; is_active: boolean }>>([]);
  const [listsLoading, setListsLoading] = useState(false);

  const [partyId, setPartyId] = useState('');
  const [tab, setTab] = useState<Tab>('items');
  const [serverRates, setServerRates] = useState<Record<string, SavedRate>>({});
  const [variants, setVariants] = useState<VariantOption[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [partyLevelId, setPartyLevelId] = useState('');
  const [overridesLoading, setOverridesLoading] = useState(false);

  const [categories, setCategories] = useState<Array<{ id: string; name: string }>>([]);
  const [serverCat, setServerCat] = useState<Record<string, SavedRate>>({});
  const [catDrafts, setCatDrafts] = useState<Record<string, Draft>>({});
  const [history, setHistory] = useState<HistoryRow[]>([]);

  const [itemSearch, setItemSearch] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!business?.id || !user?.id) return;
    const bizId = business.id;
    const userId = user.id;
    setListsLoading(true);
    const qs = `business_id=${encodeURIComponent(bizId)}&user_id=${encodeURIComponent(userId)}&limit=500`;
    Promise.all([
      fetch(`/api/customers?${qs}`, { credentials: 'include' }).then((r) => (r.ok ? r.json() : {}) as Promise<any>),
      fetch(`/api/items?${qs}`, { credentials: 'include' }).then((r) => (r.ok ? r.json() : {}) as Promise<any>),
      fetch('/api/pricing/levels', { credentials: 'include' }).then((r) => (r.ok ? r.json() : {}) as Promise<any>),
    ])
      .then(([c, i, l]) => {
        setCustomers(c.customers ?? []);
        setItems(i.items ?? []);
        setLevels(l.levels ?? []);
      })
      .finally(() => setListsLoading(false));
  }, [business?.id, user?.id]);

  const loadParty = useCallback(
    async (pid: string) => {
      setServerRates({});
      setDrafts({});
      setServerCat({});
      setCatDrafts({});
      setHistory([]);
      if (!pid) return;
      setOverridesLoading(true);
      try {
        const [pRes, cRes, hRes] = await Promise.all([
          fetch(`/api/pricing/party-item?party_id=${encodeURIComponent(pid)}`, { credentials: 'include' }),
          fetch(`/api/pricing/party-category?party_id=${encodeURIComponent(pid)}`, { credentials: 'include' }),
          fetch(`/api/pricing/history?party_id=${encodeURIComponent(pid)}`, { credentials: 'include' }),
        ]);
        const p = await pRes.json();
        if (!pRes.ok) throw new Error(p.error || `Request failed (${pRes.status})`);
        const map: Record<string, SavedRate> = {};
        for (const r of p.overrides ?? []) map[priceKey(r.item_id, r.variant_id)] = r;
        setServerRates(map);
        setDrafts(Object.fromEntries(Object.entries(map).map(([k, v]) => [k, toDraft(v)])));
        setVariants(p.variants ?? []);
        setPartyLevelId(p.price_level_id ?? '');

        const c = await cRes.json().catch(() => ({}));
        if (cRes.ok) {
          setCategories(c.categories ?? []);
          const cm: Record<string, SavedRate> = {};
          for (const r of c.discounts ?? []) cm[r.category_id] = { ...r, price: null };
          setServerCat(cm);
          setCatDrafts(Object.fromEntries(Object.entries(cm).map(([k, v]) => [k, toDraft(v)])));
        }
        const h = await hRes.json().catch(() => ({}));
        if (hRes.ok) setHistory(h.history ?? []);
      } catch (e: unknown) {
        toast.error(e instanceof Error ? e.message : 'Failed to load prices');
      } finally {
        setOverridesLoading(false);
      }
    },
    [toast]
  );

  useEffect(() => {
    void loadParty(partyId);
  }, [partyId, loadParty]);

  const allRows = useMemo<PriceRow[]>(() => {
    const byItem = new Map<string, VariantOption[]>();
    for (const v of variants) {
      const list = byItem.get(v.item_id) ?? [];
      list.push(v);
      byItem.set(v.item_id, list);
    }
    const rows: PriceRow[] = [];
    for (const it of items) {
      rows.push({ key: priceKey(it.id), item: it });
      for (const v of byItem.get(it.id) ?? []) rows.push({ key: priceKey(it.id, v.id), item: it, variant: v });
    }
    return rows;
  }, [items, variants]);

  const filteredRows = useMemo(() => {
    const q = itemSearch.trim().toLowerCase();
    if (!q) return allRows;
    return allRows.filter(
      ({ item: i, variant: v }) =>
        (i.name ?? '').toLowerCase().includes(q) ||
        (i.code ?? '').toLowerCase().includes(q) ||
        (v?.variant_name ?? '').toLowerCase().includes(q)
    );
  }, [allRows, itemSearch]);

  const dirtyKeys = useMemo(
    () => allRows.map((r) => r.key).filter((k) => draftIsDirty(drafts[k], serverRates[k])),
    [allRows, drafts, serverRates]
  );
  const dirtyCats = useMemo(
    () => categories.map((c) => c.id).filter((id) => draftIsDirty(catDrafts[id], serverCat[id])),
    [categories, catDrafts, serverCat]
  );

  const saveItemRows = useCallback(
    async (keys: string[]) => {
      if (!partyId || keys.length === 0) return;
      const rows = [];
      for (const key of keys) {
        const p = parseDraft(drafts[key] ?? EMPTY_DRAFT);
        if (p === 'invalid') {
          toast.error('Fix the highlighted rows: prices and discounts must be 0 or more, discount at most 100, and the end date after the start.');
          return;
        }
        rows.push({ ...splitPriceKey(key), ...p });
      }
      setSaving(true);
      try {
        const res = await fetch('/api/pricing/party-item', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ party_id: partyId, rows }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `Save failed (${res.status})`);
        toast.success(`Saved ${data.saved ?? rows.length} row(s)`);
        await loadParty(partyId);
      } catch (e: unknown) {
        toast.error(e instanceof Error ? e.message : 'Save failed');
      } finally {
        setSaving(false);
      }
    },
    [drafts, partyId, loadParty, toast]
  );

  const saveCategories = useCallback(async () => {
    if (!partyId || dirtyCats.length === 0) return;
    const rows = [];
    for (const id of dirtyCats) {
      const p = parseDraft(catDrafts[id] ?? EMPTY_DRAFT);
      if (p === 'invalid') {
        toast.error('Fix the highlighted rows: discount between 0 and 100, and the end date after the start.');
        return;
      }
      rows.push({ category_id: id, discount_percent: p.discount_percent, valid_from: p.valid_from, valid_to: p.valid_to });
    }
    setSaving(true);
    try {
      const res = await fetch('/api/pricing/party-category', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ party_id: partyId, rows }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Save failed (${res.status})`);
      toast.success('Category discounts saved');
      await loadParty(partyId);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }, [catDrafts, dirtyCats, partyId, loadParty, toast]);

  const changeLevel = useCallback(
    async (levelId: string) => {
      if (!partyId) return;
      const prev = partyLevelId;
      setPartyLevelId(levelId);
      try {
        const res = await fetch('/api/pricing/levels', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ assign: { price_level_id: levelId || null, customer_ids: [partyId] } }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `Save failed (${res.status})`);
        toast.success(levelId ? 'Price level set' : 'Price level removed');
      } catch (e: unknown) {
        setPartyLevelId(prev);
        toast.error(e instanceof Error ? e.message : 'Save failed');
      }
    },
    [partyId, partyLevelId, toast]
  );

  const exportCsv = () => {
    const customer = customers.find((c) => c.id === partyId);
    const lines: unknown[][] = [['item_code', 'item_name', 'variant', 'default_price', 'price', 'discount_percent', 'valid_from', 'valid_to']];
    for (const { key, item, variant } of allRows) {
      const r = serverRates[key];
      lines.push([
        item.code ?? '',
        item.name,
        variant?.variant_name ?? '',
        variant ? variant.selling_price ?? '' : item.selling_price ?? '',
        r?.price ?? '',
        r?.discount_percent ?? '',
        r?.valid_from ?? '',
        r?.valid_to ?? '',
      ]);
    }
    downloadText(`prices-${(customer?.name ?? 'customer').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.csv`, toCsv(lines));
  };

  const importCsv = async (file: File) => {
    const { rows, errors } = csvToRateRows(parseCsv(await file.text()), items, variants, { withMinQty: false });
    if (errors.length) {
      toast.error(`${errors.length} problem(s), nothing saved. ${errors.slice(0, 3).join('; ')}${errors.length > 3 ? '…' : ''}`);
      return;
    }
    if (rows.length === 0) {
      toast.error('No rows to import');
      return;
    }
    setSaving(true);
    try {
      for (let i = 0; i < rows.length; i += 300) {
        const res = await fetch('/api/pricing/party-item', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ party_id: partyId, rows: rows.slice(i, i + 300) }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `Import failed (${res.status})`);
      }
      toast.success(`Imported ${rows.length} row(s)`);
      await loadParty(partyId);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Import failed');
    } finally {
      setSaving(false);
    }
  };

  if (!canEdit) {
    return <AccessDenied module="items" action="update" details={reason} />;
  }

  const listLoading = listsLoading || (overridesLoading && !!partyId);
  const setDraft = (key: string, patch: Partial<Draft>) =>
    setDrafts((prev) => ({ ...prev, [key]: { ...(prev[key] ?? EMPTY_DRAFT), ...patch } }));
  const setCatDraft = (id: string, patch: Partial<Draft>) =>
    setCatDrafts((prev) => ({ ...prev, [id]: { ...(prev[id] ?? EMPTY_DRAFT), ...patch } }));
  const tabButton = (t: Tab, label: string) => (
    <button
      type="button"
      onClick={() => setTab(t)}
      className={`border-b-2 px-3 py-2 text-sm font-medium ${
        tab === t ? 'border-primary-600 text-primary-700' : 'border-transparent text-text-secondary hover:text-text-primary'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6">
      <Breadcrumbs />

      <div>
        <PageHeader
          title="Party item prices"
          subtitle="Set a price or a discount per customer, with optional dates. A price on an item covers its variants unless a variant has its own. Prices follow each item's GST setting (shown under the default price)."
        />
      </div>

      <Card className="p-4 md:p-6">
        <div className="flex flex-col gap-4 md:flex-row md:flex-wrap md:items-end">
          <label className="flex min-w-[220px] flex-1 flex-col gap-1">
            <span className="text-xs font-semibold uppercase text-text-muted">Customer</span>
            <select
              className="input rounded-md border border-border bg-background px-3 py-2 text-text-primary focus:outline-none focus:ring-2 focus:ring-primary-500"
              value={partyId}
              onChange={(e) => setPartyId(e.target.value)}
              disabled={listsLoading}
            >
              <option value="">Select customer…</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.company_name ? ` (${c.company_name})` : ''}
                </option>
              ))}
            </select>
          </label>

          <label className="flex min-w-[200px] flex-1 flex-col gap-1">
            <span className="text-xs font-semibold uppercase text-text-muted">Price level</span>
            <select
              className="input rounded-md border border-border bg-background px-3 py-2 text-text-primary focus:outline-none focus:ring-2 focus:ring-primary-500"
              value={partyLevelId}
              onChange={(e) => void changeLevel(e.target.value)}
              disabled={!partyId || listLoading}
            >
              <option value="">None (item prices)</option>
              {levels.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                  {l.is_active ? '' : ' (inactive)'}
                </option>
              ))}
            </select>
            <span className="text-xs text-text-muted">
              Used when this customer has no price of their own. <Link href="/pricing/levels" className="text-primary-600 hover:underline">Manage levels</Link>
            </span>
          </label>
        </div>

        {!partyId && <p className="mt-4 text-sm text-text-muted">Choose a customer to load items and any saved custom prices.</p>}
      </Card>

      {partyId && (
        <div className="flex gap-1 border-b border-border">
          {tabButton('items', 'Item prices')}
          {tabButton('categories', 'Category discounts')}
          {tabButton('history', 'History')}
        </div>
      )}

      {partyId && tab === 'items' && (
        <Card className="overflow-hidden p-0">
          <div className="flex flex-col gap-3 border-b border-border p-4 md:flex-row md:items-end">
            <label className="flex min-w-[200px] flex-1 flex-col gap-1">
              <span className="text-xs font-semibold uppercase text-text-muted">Search items</span>
              <Input value={itemSearch} onChange={(e) => setItemSearch(e.target.value)} placeholder="Filter by name, code or variant…" />
            </label>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="secondary" onClick={exportCsv} disabled={listLoading}>
                Export CSV
              </Button>
              <label className="inline-flex cursor-pointer items-center rounded-md border border-border px-3 py-2 text-sm font-medium text-text-primary hover:bg-muted/50">
                Import CSV
                <input
                  type="file"
                  accept=".csv,text/csv"
                  className="sr-only"
                  disabled={saving}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    if (f) void importCsv(f);
                  }}
                />
              </label>
              <Link
                href={`/pricing/price-list?customer_id=${encodeURIComponent(partyId)}`}
                className="inline-flex items-center rounded-md border border-border px-3 py-2 text-sm font-medium text-text-primary hover:bg-muted/50"
              >
                Price list
              </Link>
              <Button type="button" variant="primary" onClick={() => void saveItemRows(dirtyKeys)} disabled={saving || dirtyKeys.length === 0} isLoading={saving}>
                <Save className="mr-2 h-4 w-4" aria-hidden />
                Save all changes{dirtyKeys.length > 0 ? ` (${dirtyKeys.length})` : ''}
              </Button>
            </div>
          </div>
          {listLoading ? (
            <div className="flex min-h-[240px] items-center justify-center p-8">
              <Loader2 className="h-8 w-8 animate-spin text-primary-600" aria-hidden />
            </div>
          ) : filteredRows.length === 0 ? (
            <div className="flex min-h-[200px] items-center justify-center p-8 text-text-secondary">
              {items.length === 0 ? 'No active items.' : 'No items match your search.'}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border bg-surface-elevated dark:bg-slate-800/50">
                    <th className="px-4 py-3 text-left font-semibold text-text-primary">Item</th>
                    <th className="px-3 py-3 text-right font-semibold text-text-primary">Default price</th>
                    <th className="min-w-[120px] px-2 py-3 text-left font-semibold text-text-primary">Price</th>
                    <th className="min-w-[80px] px-2 py-3 text-left font-semibold text-text-primary">Disc %</th>
                    <th className="px-2 py-3 text-left font-semibold text-text-primary">From</th>
                    <th className="px-2 py-3 text-left font-semibold text-text-primary">To</th>
                    <th className="px-3 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map(({ key, item: it, variant }) => {
                    const rawSelling = variant ? variant.selling_price : it.selling_price;
                    const selling = rawSelling == null ? NaN : Number(rawSelling);
                    const itemWide = !variant && it.has_variants;
                    const d = drafts[key] ?? EMPTY_DRAFT;
                    const dirty = draftIsDirty(d, serverRates[key]);
                    const invalid = parseDraft(d) === 'invalid';
                    const label = variant ? `${it.name} - ${variant.variant_name}` : it.name;
                    const ring = invalid
                      ? 'border-red-400 ring-1 ring-red-300'
                      : dirty
                        ? 'border-primary-400 ring-1 ring-primary-300/60 dark:ring-primary-700/60'
                        : '';
                    return (
                      <tr key={key} className="border-b border-border/80 hover:bg-muted/40 dark:hover:bg-slate-800/30">
                        <td className={`max-w-[260px] px-4 py-2 align-middle ${variant ? 'pl-10' : ''}`}>
                          <div className="font-medium text-text-primary">{variant ? variant.variant_name : it.name}</div>
                          {itemWide ? (
                            <div className="mt-0.5 text-xs text-text-muted">All variants{it.code ? ` · ${it.code}` : ''}</div>
                          ) : !variant && it.code ? (
                            <div className="mt-0.5 text-xs text-text-muted">{it.code}</div>
                          ) : null}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-right align-middle tabular-nums text-text-secondary">
                          {Number.isFinite(selling) ? formatInr(selling) : '—'}
                          <div className="text-xs text-text-muted">{it.gst_included ? 'incl. GST' : 'excl. GST'}</div>
                        </td>
                        <td className="px-2 py-2 align-middle">
                          <Input
                            type="text"
                            inputMode="decimal"
                            className={ring}
                            value={d.price}
                            onChange={(e) => setDraft(key, { price: e.target.value })}
                            placeholder={itemWide ? 'All variants' : Number.isFinite(selling) ? `Default ${formatInr(selling)}` : '—'}
                            aria-label={`Custom price for ${label}`}
                          />
                        </td>
                        <td className="px-2 py-2 align-middle">
                          <Input
                            type="text"
                            inputMode="decimal"
                            className={ring}
                            value={d.discount}
                            onChange={(e) => setDraft(key, { discount: e.target.value })}
                            placeholder="—"
                            aria-label={`Discount % for ${label}`}
                          />
                        </td>
                        <td className="px-2 py-2 align-middle">
                          <Input type="date" value={d.from} onChange={(e) => setDraft(key, { from: e.target.value })} aria-label={`Price from date for ${label}`} />
                        </td>
                        <td className="px-2 py-2 align-middle">
                          <Input type="date" value={d.to} onChange={(e) => setDraft(key, { to: e.target.value })} aria-label={`Price to date for ${label}`} />
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-right align-middle">
                          <Button type="button" variant="secondary" size="sm" disabled={!dirty || saving} onClick={() => void saveItemRows([key])}>
                            Save
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {partyId && tab === 'categories' && (
        <Card className="overflow-hidden p-0">
          <div className="flex flex-col gap-2 border-b border-border p-4 md:flex-row md:items-center md:justify-between">
            <p className="text-sm text-text-secondary">
              A discount on every item in a category (a brand or product group). An item&apos;s own discount for this customer wins.
            </p>
            <Button type="button" variant="primary" onClick={() => void saveCategories()} disabled={saving || dirtyCats.length === 0} isLoading={saving}>
              <Save className="mr-2 h-4 w-4" aria-hidden />
              Save{dirtyCats.length > 0 ? ` (${dirtyCats.length})` : ''}
            </Button>
          </div>
          {categories.length === 0 ? (
            <div className="p-8 text-center text-text-secondary">No item categories yet. Add categories to your items first.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border bg-surface-elevated dark:bg-slate-800/50">
                    <th className="px-4 py-3 text-left font-semibold text-text-primary">Category</th>
                    <th className="min-w-[100px] px-2 py-3 text-left font-semibold text-text-primary">Disc %</th>
                    <th className="px-2 py-3 text-left font-semibold text-text-primary">From</th>
                    <th className="px-2 py-3 text-left font-semibold text-text-primary">To</th>
                  </tr>
                </thead>
                <tbody>
                  {categories.map((c) => {
                    const d = catDrafts[c.id] ?? EMPTY_DRAFT;
                    const invalid = parseDraft(d) === 'invalid';
                    return (
                      <tr key={c.id} className="border-b border-border/80">
                        <td className="px-4 py-2 font-medium text-text-primary">{c.name}</td>
                        <td className="px-2 py-2">
                          <Input
                            type="text"
                            inputMode="decimal"
                            className={invalid ? 'border-red-400 ring-1 ring-red-300' : ''}
                            value={d.discount}
                            onChange={(e) => setCatDraft(c.id, { discount: e.target.value })}
                            placeholder="—"
                            aria-label={`Discount % on ${c.name}`}
                          />
                        </td>
                        <td className="px-2 py-2">
                          <Input type="date" value={d.from} onChange={(e) => setCatDraft(c.id, { from: e.target.value })} aria-label={`From date for ${c.name}`} />
                        </td>
                        <td className="px-2 py-2">
                          <Input type="date" value={d.to} onChange={(e) => setCatDraft(c.id, { to: e.target.value })} aria-label={`To date for ${c.name}`} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {partyId && tab === 'history' && (
        <Card className="overflow-hidden p-0">
          {history.length === 0 ? (
            <div className="p-8 text-center text-text-secondary">No price changes for this customer yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border bg-surface-elevated dark:bg-slate-800/50">
                    <th className="px-4 py-3 text-left font-semibold text-text-primary">When</th>
                    <th className="px-3 py-3 text-left font-semibold text-text-primary">Item / category</th>
                    <th className="px-3 py-3 text-left font-semibold text-text-primary">Was</th>
                    <th className="px-3 py-3 text-left font-semibold text-text-primary">Now</th>
                    <th className="px-3 py-3 text-left font-semibold text-text-primary">By</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((h) => (
                    <tr key={h.id} className="border-b border-border/80">
                      <td className="whitespace-nowrap px-4 py-2 text-text-secondary">
                        {new Date(h.changed_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td className="px-3 py-2 text-text-primary">
                        {h.category_name ? `${h.category_name} (category)` : `${h.item_name ?? '—'}${h.variant_name ? ` - ${h.variant_name}` : ''}`}
                      </td>
                      <td className="px-3 py-2 text-text-secondary">{rateText(h.old_price, h.old_discount_percent)}</td>
                      <td className="px-3 py-2 text-text-primary">
                        {rateText(h.new_price, h.new_discount_percent)}
                        {h.valid_from || h.valid_to ? (
                          <span className="block text-xs text-text-muted">
                            {h.valid_from ?? '…'} to {h.valid_to ?? '…'}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 text-text-secondary">{h.changed_by_name ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
