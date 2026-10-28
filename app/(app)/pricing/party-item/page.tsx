'use client';

export const dynamic = 'force-dynamic';

import { PageHeader } from '@/components/layout/PageHeader';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

function normalizeDraftValue(overrides: Record<string, number>, key: string): string {
  const p = overrides[key];
  return p !== undefined && p !== null && Number.isFinite(p) ? String(p) : '';
}

/** Parse input: '' → remove override (null); else finite number required */
function parseCustomPrice(raw: string): number | null | 'invalid' {
  const t = raw.trim();
  if (t === '') return null;
  const n = parseFloat(t);
  if (!Number.isFinite(n) || n < 0) return 'invalid';
  return Math.round(n * 100) / 100;
}

function rowIsDirty(itemId: string, draftVal: string, overrides: Record<string, number>): boolean {
  const target = parseCustomPrice(draftVal);
  if (target === 'invalid') return true;
  const prev = overrides[itemId];
  if (target === null) {
    return prev !== undefined && prev !== null;
  }
  if (prev === undefined || prev === null) return true;
  return Math.abs(prev - target) > 1e-6;
}

export default function PartyItemPricingPage() {
  const { business, user } = useAuth();
  const toast = useToastContext();

  const { allowed: canEdit, loading: authLoading, reason } = useAuthorizationGuard({
    resource: 'items',
    action: 'update',
    skipCheck: !user?.id || !business?.id,
  });

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [customersLoading, setCustomersLoading] = useState(false);
  const [itemsLoading, setItemsLoading] = useState(false);

  const [partyId, setPartyId] = useState('');
  const [serverOverrides, setServerOverrides] = useState<Record<string, number>>({});
  const [variants, setVariants] = useState<VariantOption[]>([]);
  const [draftByItem, setDraftByItem] = useState<Record<string, string>>({});
  const [overridesLoading, setOverridesLoading] = useState(false);

  const [itemSearch, setItemSearch] = useState('');
  const [savingBulk, setSavingBulk] = useState(false);
  const [savingRowId, setSavingRowId] = useState<string | null>(null);

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
      for (const v of byItem.get(it.id) ?? []) {
        rows.push({ key: priceKey(it.id, v.id), item: it, variant: v });
      }
    }
    return rows;
  }, [items, variants]);

  const allRowsRef = useRef<PriceRow[]>([]);
  useEffect(() => {
    allRowsRef.current = allRows;
  }, [allRows]);

  useEffect(() => {
    if (!business?.id || !user?.id) return;

    async function load() {
      const bizId = business?.id;
      const userId = user?.id;
      if (!bizId || !userId) return;
      setCustomersLoading(true);
      setItemsLoading(true);
      try {
        const qs = `business_id=${encodeURIComponent(bizId)}&user_id=${encodeURIComponent(userId)}&limit=500`;
        const [cRes, iRes] = await Promise.all([
          fetch(`/api/customers?${qs}`, { credentials: 'include' }),
          fetch(`/api/items?${qs}`, { credentials: 'include' }),
        ]);
        const cJson = await cRes.json().catch(() => ({}));
        const iJson = await iRes.json().catch(() => ({}));
        if (cRes.ok) setCustomers(cJson.customers ?? []);
        if (iRes.ok) setItems(iJson.items ?? []);
      } finally {
        setCustomersLoading(false);
        setItemsLoading(false);
      }
    }

    void load();
  }, [business?.id, user?.id]);

  const loadOverrides = useCallback(
    async (pid: string) => {
      if (!pid.trim()) {
        setServerOverrides({});
        setVariants([]);
        setDraftByItem({});
        return;
      }
      setOverridesLoading(true);
      try {
        const res = await fetch(
          `/api/pricing/party-item?party_id=${encodeURIComponent(pid)}`,
          { credentials: 'include' }
        );
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || `Request failed (${res.status})`);
        }
        const list = (data.overrides ?? []) as { item_id: string; variant_id: string | null; price: number }[];
        const map: Record<string, number> = {};
        for (const r of list) {
          map[priceKey(r.item_id, r.variant_id)] = Number(r.price);
        }
        setServerOverrides(map);
        setVariants((data.variants ?? []) as VariantOption[]);

        const nextDraft: Record<string, string> = {};
        for (const row of allRowsRef.current) {
          nextDraft[row.key] = normalizeDraftValue(map, row.key);
        }
        setDraftByItem(nextDraft);
      } catch (e: unknown) {
        toast.error(e instanceof Error ? e.message : 'Failed to load overrides');
      } finally {
        setOverridesLoading(false);
      }
    },
    [toast]
  );

  /** When catalog items or variants arrive after overrides, hydrate missing draft keys only */
  useEffect(() => {
    if (!partyId.trim()) return;
    setDraftByItem((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const row of allRows) {
        if (next[row.key] === undefined) {
          next[row.key] = normalizeDraftValue(serverOverrides, row.key);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [partyId, allRows, serverOverrides]);

  useEffect(() => {
    void loadOverrides(partyId);
  }, [partyId, loadOverrides]);

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

  const dirtyRows = useMemo(() => {
    const keys: string[] = [];
    for (const row of allRows) {
      const d = draftByItem[row.key] ?? '';
      if (rowIsDirty(row.key, d, serverOverrides)) keys.push(row.key);
    }
    return keys;
  }, [allRows, draftByItem, serverOverrides]);

  const saveRow = useCallback(
    async (key: string) => {
      const raw = draftByItem[key] ?? '';
      const target = parseCustomPrice(raw);
      if (target === 'invalid') {
        toast.error('Enter a valid non‑negative price, or leave empty to use the catalog default.');
        return;
      }
      if (!partyId.trim()) {
        toast.error('Select a customer first.');
        return;
      }

      setSavingRowId(key);
      try {
        const body = { party_id: partyId, ...splitPriceKey(key), price: target };

        const res = await fetch('/api/pricing/party-item', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `Save failed (${res.status})`);

        toast.success('Saved');
        await loadOverrides(partyId);
      } catch (e: unknown) {
        toast.error(e instanceof Error ? e.message : 'Save failed');
      } finally {
        setSavingRowId(null);
      }
    },
    [draftByItem, partyId, loadOverrides, toast]
  );

  const saveAllDirty = useCallback(async () => {
    if (!partyId.trim()) {
      toast.error('Select a customer first.');
      return;
    }
    if (dirtyRows.length === 0) {
      toast.error('Nothing to save.');
      return;
    }

    const rows: { item_id: string; variant_id: string | null; price: number | null }[] = [];
    for (const key of dirtyRows) {
      const raw = draftByItem[key] ?? '';
      const target = parseCustomPrice(raw);
      if (target === 'invalid') {
        toast.error('Fix invalid prices before saving all.');
        return;
      }
      rows.push({ ...splitPriceKey(key), price: target });
    }

    setSavingBulk(true);
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
      await loadOverrides(partyId);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSavingBulk(false);
    }
  }, [dirtyRows, draftByItem, partyId, loadOverrides, toast]);

  if (!canEdit) {
    return <AccessDenied module="items" action="update" details={reason} />;
  }

  const listLoading =
    customersLoading || itemsLoading || (overridesLoading && !!partyId);

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-6">
      <Breadcrumbs />

      <div>
        <PageHeader
  title="Party item prices"
  subtitle="Set catalog overrides per customer. Empty custom price keeps the default selling price from the item master. A price on an item covers its variants unless a variant has its own."
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
              disabled={listLoading || customersLoading}
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
            <span className="text-xs font-semibold uppercase text-text-muted">Search items</span>
            <Input
              value={itemSearch}
              onChange={(e) => setItemSearch(e.target.value)}
              placeholder="Filter by name or code…"
              disabled={!partyId || listLoading}
            />
          </label>

          <div className="flex flex-wrap gap-2 md:ml-auto">
            <Button
              type="button"
              variant="primary"
              onClick={() => void saveAllDirty()}
              disabled={!partyId || savingBulk || dirtyRows.length === 0}
              isLoading={savingBulk}
            >
              <Save className="mr-2 h-4 w-4" aria-hidden />
              Save all changes
              {dirtyRows.length > 0 ? ` (${dirtyRows.length})` : ''}
            </Button>
          </div>
        </div>

        {!partyId && (
          <p className="mt-4 text-sm text-text-muted">Choose a customer to load items and any saved custom prices.</p>
        )}
      </Card>

      <Card className="overflow-hidden p-0">
        {!partyId ? (
          <div className="flex min-h-[200px] items-center justify-center p-8 text-text-secondary">
            Select a customer to begin.
          </div>
        ) : listLoading ? (
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
                  <th className="px-4 py-3 text-right font-semibold text-text-primary">Default price</th>
                  <th className="min-w-[200px] px-4 py-3 text-left font-semibold text-text-primary">
                    Custom price
                  </th>
                  <th className="px-4 py-3 text-right font-semibold text-text-primary"> </th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map(({ key, item: it, variant }) => {
                  const rawSelling = variant ? variant.selling_price : it.selling_price;
                  const selling = rawSelling == null ? NaN : Number(rawSelling);
                  const itemWide = !variant && it.has_variants;
                  const placeholder = itemWide
                    ? 'Applies to all variants'
                    : Number.isFinite(selling)
                      ? `Default ${formatInr(selling)}`
                      : 'No default in catalog';
                  const dv = draftByItem[key] ?? '';
                  const dirty = rowIsDirty(key, dv, serverOverrides);
                  const label = variant ? `${it.name} - ${variant.variant_name}` : it.name;

                  return (
                    <tr
                      key={key}
                      className="border-b border-border/80 hover:bg-muted/40 dark:hover:bg-slate-800/30"
                    >
                      <td className={`max-w-[280px] px-4 py-2 align-middle ${variant ? 'pl-10' : ''}`}>
                        <div className="font-medium text-text-primary">{variant ? variant.variant_name : it.name}</div>
                        {itemWide ? (
                          <div className="mt-0.5 text-xs text-text-muted">All variants{it.code ? ` · ${it.code}` : ''}</div>
                        ) : !variant && it.code ? (
                          <div className="mt-0.5 text-xs text-text-muted">{it.code}</div>
                        ) : null}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2 align-middle text-right tabular-nums text-text-secondary">
                        {Number.isFinite(selling) ? formatInr(selling) : '—'}
                        {Number.isFinite(selling) || itemWide ? (
                          <div className="text-xs text-text-muted">{it.gst_included ? 'incl. GST' : 'excl. GST'}</div>
                        ) : null}
                      </td>
                      <td className="px-4 py-2 align-middle">
                        <Input
                          type="text"
                          inputMode="decimal"
                          className={
                            dirty ? 'border-primary-400 ring-1 ring-primary-300/60 dark:ring-primary-700/60' : ''
                          }
                          value={dv}
                          onChange={(e) =>
                            setDraftByItem((prev) => ({ ...prev, [key]: e.target.value }))
                          }
                          placeholder={placeholder}
                          aria-label={`Custom price for ${label}`}
                        />
                      </td>
                      <td className="whitespace-nowrap px-4 py-2 align-middle text-right">
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          disabled={!dirty || savingRowId !== null || savingBulk}
                          isLoading={savingRowId === key}
                          onClick={() => void saveRow(key)}
                        >
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
    </div>
  );
}
