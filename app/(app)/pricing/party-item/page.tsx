'use client';

export const dynamic = 'force-dynamic';

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

function normalizeDraftValue(overrides: Record<string, number>, itemId: string): string {
  const p = overrides[itemId];
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
  const [draftByItem, setDraftByItem] = useState<Record<string, string>>({});
  const [overridesLoading, setOverridesLoading] = useState(false);

  const [itemSearch, setItemSearch] = useState('');
  const [savingBulk, setSavingBulk] = useState(false);
  const [savingRowId, setSavingRowId] = useState<string | null>(null);

  const itemsRef = useRef<Item[]>([]);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

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
        const list = (data.overrides ?? []) as { item_id: string; price: number }[];
        const map: Record<string, number> = {};
        for (const r of list) {
          map[r.item_id] = Number(r.price);
        }
        setServerOverrides(map);

        const snapshot = itemsRef.current;
        const nextDraft: Record<string, string> = {};
        for (const it of snapshot) {
          nextDraft[it.id] = normalizeDraftValue(map, it.id);
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

  /** When catalog items arrive after overrides, hydrate missing draft keys only */
  useEffect(() => {
    if (!partyId.trim()) return;
    setDraftByItem((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const it of items) {
        if (next[it.id] === undefined) {
          next[it.id] = normalizeDraftValue(serverOverrides, it.id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [partyId, items, serverOverrides]);

  useEffect(() => {
    void loadOverrides(partyId);
  }, [partyId, loadOverrides]);

  const filteredItems = useMemo(() => {
    const q = itemSearch.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (i) =>
        (i.name ?? '').toLowerCase().includes(q) || (i.code ?? '').toLowerCase().includes(q)
    );
  }, [items, itemSearch]);

  const dirtyRows = useMemo(() => {
    const ids: string[] = [];
    for (const it of items) {
      const d = draftByItem[it.id] ?? '';
      if (rowIsDirty(it.id, d, serverOverrides)) ids.push(it.id);
    }
    return ids;
  }, [items, draftByItem, serverOverrides]);

  const saveRow = useCallback(
    async (itemId: string) => {
      const raw = draftByItem[itemId] ?? '';
      const target = parseCustomPrice(raw);
      if (target === 'invalid') {
        toast.error('Enter a valid non‑negative price, or leave empty to use the catalog default.');
        return;
      }
      if (!partyId.trim()) {
        toast.error('Select a customer first.');
        return;
      }

      setSavingRowId(itemId);
      try {
        const body =
          target === null
            ? { party_id: partyId, item_id: itemId, price: null }
            : { party_id: partyId, item_id: itemId, price: target };

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

    const rows: { item_id: string; price: number | null }[] = [];
    for (const itemId of dirtyRows) {
      const raw = draftByItem[itemId] ?? '';
      const target = parseCustomPrice(raw);
      if (target === 'invalid') {
        toast.error('Fix invalid prices before saving all.');
        return;
      }
      rows.push({ item_id: itemId, price: target });
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
        <h1 className="text-2xl font-bold text-text-primary">Party item prices</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Set catalog overrides per customer. Empty custom price keeps the default selling price from the item master.
        </p>
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
        ) : filteredItems.length === 0 ? (
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
                {filteredItems.map((it) => {
                  const selling = Number(it.selling_price ?? 0);
                  const placeholder = Number.isFinite(selling)
                    ? `Default ${formatInr(selling)}`
                    : 'No default in catalog';
                  const dv = draftByItem[it.id] ?? '';
                  const dirty = rowIsDirty(it.id, dv, serverOverrides);

                  return (
                    <tr
                      key={it.id}
                      className="border-b border-border/80 hover:bg-muted/40 dark:hover:bg-slate-800/30"
                    >
                      <td className="max-w-[280px] px-4 py-2 align-middle">
                        <div className="font-medium text-text-primary">{it.name}</div>
                        {it.code ? (
                          <div className="mt-0.5 text-xs text-text-muted">{it.code}</div>
                        ) : null}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2 align-middle text-right tabular-nums text-text-secondary">
                        {Number.isFinite(selling) ? formatInr(selling) : '—'}
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
                            setDraftByItem((prev) => ({ ...prev, [it.id]: e.target.value }))
                          }
                          placeholder={placeholder}
                          aria-label={`Custom price for ${it.name}`}
                        />
                      </td>
                      <td className="whitespace-nowrap px-4 py-2 align-middle text-right">
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          disabled={!dirty || savingRowId !== null || savingBulk}
                          isLoading={savingRowId === it.id}
                          onClick={() => void saveRow(it.id)}
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
