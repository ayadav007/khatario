'use client';

export const dynamic = 'force-dynamic';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Loader2, Plus, Save, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Breadcrumbs } from '@/components/navigation/Breadcrumbs';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useAuth } from '@/contexts/AuthContext';
import { useToastContext } from '@/contexts/ToastContext';
import { useAuthorizationGuard } from '@/hooks/useAuthorizationGuard';
import { AccessDenied } from '@/components/common/AccessDenied';
import type { Customer, Item } from '@/types/database';

interface Level {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  customer_count: number;
  rate_count: number;
}

interface Rate {
  item_id: string;
  variant_id: string | null;
  min_qty: number;
  price: number | null;
  discount_percent: number | null;
  valid_from: string | null;
  valid_to: string | null;
}

interface VariantOption {
  id: string;
  item_id: string;
  variant_name: string;
  selling_price: number | null;
}

interface RateForm {
  item_id: string;
  variant_id: string;
  min_qty: string;
  price: string;
  discount: string;
  from: string;
  to: string;
}

const EMPTY_FORM: RateForm = { item_id: '', variant_id: '', min_qty: '0', price: '', discount: '', from: '', to: '' };

const inr = (n: number | null | undefined) =>
  n == null ? '—' : `₹${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

async function postJson(url: string, body: unknown) {
  const res = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

/**
 * Price levels (Wholesale, Retail, Dealer...): rates per item or variant with quantity slabs and
 * dates. A customer on a level gets its rate when they have no customer price of their own.
 */
export default function PriceLevelsPage() {
  const { business, user } = useAuth();
  const toast = useToastContext();
  const { allowed: canEdit, reason } = useAuthorizationGuard({
    resource: 'items',
    action: 'update',
    skipCheck: !user?.id || !business?.id,
  });

  const [levels, setLevels] = useState<Level[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState('');
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);

  const [rates, setRates] = useState<Rate[]>([]);
  const [variants, setVariants] = useState<VariantOption[]>([]);
  const [levelCustomers, setLevelCustomers] = useState<Array<{ id: string; name: string }>>([]);
  const [ratesLoading, setRatesLoading] = useState(false);
  const [form, setForm] = useState<RateForm>(EMPTY_FORM);
  const [itemSearch, setItemSearch] = useState('');
  const [addCustomerId, setAddCustomerId] = useState('');
  const [editName, setEditName] = useState('');

  const loadLevels = useCallback(async () => {
    const res = await fetch('/api/pricing/levels', { credentials: 'include' });
    const data = await res.json().catch(() => ({}));
    if (res.ok) setLevels(data.levels ?? []);
    else toast.error(data.error || 'Failed to load price levels');
  }, [toast]);

  useEffect(() => {
    if (!business?.id || !user?.id) return;
    const qs = `business_id=${encodeURIComponent(business.id)}&user_id=${encodeURIComponent(user.id)}&limit=500`;
    setLoading(true);
    Promise.all([
      loadLevels(),
      fetch(`/api/items?${qs}`, { credentials: 'include' }).then((r) => (r.ok ? r.json() : {}) as Promise<any>).then((d) => setItems(d.items ?? [])),
      fetch(`/api/customers?${qs}`, { credentials: 'include' }).then((r) => (r.ok ? r.json() : {}) as Promise<any>).then((d) => setCustomers(d.customers ?? [])),
    ]).finally(() => setLoading(false));
  }, [business?.id, user?.id, loadLevels]);

  const loadRates = useCallback(
    async (id: string) => {
      setRates([]);
      setLevelCustomers([]);
      if (!id) return;
      setRatesLoading(true);
      try {
        const res = await fetch(`/api/pricing/levels/${id}/rates`, { credentials: 'include' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to load rates');
        setRates(data.rates ?? []);
        setVariants(data.variants ?? []);
        setLevelCustomers(data.customers ?? []);
        setEditName(data.level?.name ?? '');
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Failed to load rates');
      } finally {
        setRatesLoading(false);
      }
    },
    [toast]
  );

  useEffect(() => {
    void loadRates(selectedId);
    setForm(EMPTY_FORM);
  }, [selectedId, loadRates]);

  const selected = levels.find((l) => l.id === selectedId) ?? null;
  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const variantById = useMemo(() => new Map(variants.map((v) => [v.id, v])), [variants]);
  const formVariants = variants.filter((v) => v.item_id === form.item_id);
  const pickableItems = useMemo(() => {
    const q = itemSearch.trim().toLowerCase();
    const list = q ? items.filter((i) => (i.name ?? '').toLowerCase().includes(q) || (i.code ?? '').toLowerCase().includes(q)) : items;
    return list.slice(0, 200);
  }, [items, itemSearch]);

  const createLevel = async () => {
    if (!newName.trim()) return;
    setBusy(true);
    try {
      const data = await postJson('/api/pricing/levels', { name: newName.trim() });
      setNewName('');
      await loadLevels();
      setSelectedId(data.level.id);
      toast.success('Price level created');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not create the level');
    } finally {
      setBusy(false);
    }
  };

  const updateLevel = async (patch: { name?: string; is_active?: boolean }) => {
    if (!selected) return;
    setBusy(true);
    try {
      await postJson('/api/pricing/levels', {
        id: selected.id,
        name: patch.name ?? selected.name,
        description: selected.description,
        is_active: patch.is_active ?? selected.is_active,
      });
      await loadLevels();
      toast.success('Saved');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  const deleteLevel = async () => {
    if (!selected) return;
    if (!window.confirm(`Delete "${selected.name}" and its ${selected.rate_count} rate(s)? Its customers go back to item prices.`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/pricing/levels?id=${selected.id}`, { method: 'DELETE', credentials: 'include' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Delete failed');
      setSelectedId('');
      await loadLevels();
      toast.success('Price level deleted');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setBusy(false);
    }
  };

  const saveRate = async (row: Rate | null, remove = false) => {
    if (!selected) return;
    const body = row
      ? { ...row, price: remove ? null : row.price, discount_percent: remove ? null : row.discount_percent }
      : {
          item_id: form.item_id,
          variant_id: form.variant_id || null,
          min_qty: form.min_qty || 0,
          price: form.price,
          discount_percent: form.discount,
          valid_from: form.from || null,
          valid_to: form.to || null,
        };
    if (!row && !form.item_id) {
      toast.error('Pick an item');
      return;
    }
    if (!row && !form.price.trim() && !form.discount.trim()) {
      toast.error('Enter a price, a discount %, or both');
      return;
    }
    setBusy(true);
    try {
      await postJson(`/api/pricing/levels/${selected.id}/rates`, { rows: [body] });
      if (!row) setForm((f) => ({ ...EMPTY_FORM, item_id: f.item_id, variant_id: f.variant_id }));
      await Promise.all([loadRates(selected.id), loadLevels()]);
      toast.success(remove ? 'Rate removed' : 'Rate saved');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  const assign = async (customerIds: string[], levelId: string | null) => {
    if (customerIds.length === 0) return;
    setBusy(true);
    try {
      await postJson('/api/pricing/levels', { assign: { price_level_id: levelId, customer_ids: customerIds } });
      setAddCustomerId('');
      if (selected) await Promise.all([loadRates(selected.id), loadLevels()]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  if (!canEdit) return <AccessDenied module="items" action="update" details={reason} />;

  const selectClass =
    'input w-full rounded-md border border-border bg-background px-3 py-2 text-text-primary focus:outline-none focus:ring-2 focus:ring-primary-500';

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6">
      <Breadcrumbs />
      <PageHeader
        title="Price levels"
        subtitle="Rate lists such as Wholesale, Retail or Dealer, with quantity slabs and dates. A customer on a level gets these rates unless they have their own price (set on Party item prices)."
      />

      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        <Card className="space-y-3 p-4">
          <div className="flex gap-2">
            <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="New level, e.g. Wholesale" aria-label="New price level name" />
            <Button type="button" onClick={() => void createLevel()} disabled={busy || !newName.trim()} aria-label="Add price level">
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          {loading ? (
            <Loader2 className="mx-auto h-6 w-6 animate-spin text-primary-600" aria-hidden />
          ) : levels.length === 0 ? (
            <p className="text-sm text-text-muted">No price levels yet.</p>
          ) : (
            <ul className="space-y-1">
              {levels.map((l) => (
                <li key={l.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(l.id)}
                    className={`w-full rounded-md px-3 py-2 text-left text-sm ${
                      l.id === selectedId ? 'bg-primary-50 text-primary-800 dark:bg-primary-950/40 dark:text-primary-200' : 'hover:bg-muted/50'
                    }`}
                  >
                    <span className="font-medium">{l.name}</span>
                    {!l.is_active && <span className="ml-1 text-xs text-text-muted">(inactive)</span>}
                    <span className="block text-xs text-text-muted">
                      {l.customer_count} customer(s) · {l.rate_count} rate(s)
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {!selected ? (
          <Card className="flex min-h-[200px] items-center justify-center p-8 text-text-secondary">Pick or create a price level.</Card>
        ) : (
          <div className="space-y-6">
            <Card className="flex flex-col gap-3 p-4 md:flex-row md:items-end">
              <label className="flex flex-1 flex-col gap-1">
                <span className="text-xs font-semibold uppercase text-text-muted">Name</span>
                <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
              </label>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="secondary" disabled={busy || !editName.trim() || editName === selected.name} onClick={() => void updateLevel({ name: editName.trim() })}>
                  Rename
                </Button>
                <Button type="button" variant="secondary" disabled={busy} onClick={() => void updateLevel({ is_active: !selected.is_active })}>
                  {selected.is_active ? 'Deactivate' : 'Activate'}
                </Button>
                <Button type="button" variant="ghost" disabled={busy} onClick={() => void deleteLevel()}>
                  <Trash2 className="mr-1 h-4 w-4" /> Delete
                </Button>
              </div>
            </Card>

            <Card className="space-y-4 p-4">
              <h2 className="text-base font-semibold text-text-primary">Add or change a rate</h2>
              <p className="text-xs text-text-muted">
                Minimum quantity 0 is the base rate; add more rows with a higher minimum for quantity slabs. A rate with the same item, variant,
                minimum quantity and start date replaces the old one. Prices follow each item&apos;s GST setting.
              </p>
              <div className="grid gap-3 md:grid-cols-4">
                <label className="flex flex-col gap-1 md:col-span-2">
                  <span className="text-xs font-semibold uppercase text-text-muted">Item</span>
                  <Input value={itemSearch} onChange={(e) => setItemSearch(e.target.value)} placeholder="Search items…" aria-label="Search items" />
                  <select
                    className={selectClass}
                    value={form.item_id}
                    onChange={(e) => setForm({ ...form, item_id: e.target.value, variant_id: '' })}
                    aria-label="Item"
                  >
                    <option value="">Select item…</option>
                    {pickableItems.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.name}
                        {i.code ? ` (${i.code})` : ''}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 md:col-span-2">
                  <span className="text-xs font-semibold uppercase text-text-muted">Variant</span>
                  <select
                    className={selectClass}
                    value={form.variant_id}
                    onChange={(e) => setForm({ ...form, variant_id: e.target.value })}
                    disabled={formVariants.length === 0}
                    aria-label="Variant"
                  >
                    <option value="">{formVariants.length ? 'All variants' : 'No variants'}</option>
                    {formVariants.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.variant_name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-semibold uppercase text-text-muted">Min qty</span>
                  <Input type="text" inputMode="decimal" value={form.min_qty} onChange={(e) => setForm({ ...form, min_qty: e.target.value })} />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-semibold uppercase text-text-muted">Price</span>
                  <Input type="text" inputMode="decimal" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} placeholder="Item price" />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-semibold uppercase text-text-muted">Disc %</span>
                  <Input type="text" inputMode="decimal" value={form.discount} onChange={(e) => setForm({ ...form, discount: e.target.value })} placeholder="—" />
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <label className="flex flex-col gap-1">
                    <span className="text-xs font-semibold uppercase text-text-muted">From</span>
                    <Input type="date" value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-xs font-semibold uppercase text-text-muted">To</span>
                    <Input type="date" value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })} />
                  </label>
                </div>
              </div>
              <Button type="button" onClick={() => void saveRate(null)} disabled={busy} isLoading={busy}>
                <Save className="mr-2 h-4 w-4" /> Save rate
              </Button>
            </Card>

            <Card className="overflow-hidden p-0">
              {ratesLoading ? (
                <div className="flex min-h-[160px] items-center justify-center">
                  <Loader2 className="h-6 w-6 animate-spin text-primary-600" aria-hidden />
                </div>
              ) : rates.length === 0 ? (
                <div className="p-8 text-center text-text-secondary">No rates on this level yet.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-border bg-surface-elevated dark:bg-slate-800/50">
                        <th className="px-4 py-3 text-left font-semibold">Item</th>
                        <th className="px-3 py-3 text-right font-semibold">Item price</th>
                        <th className="px-3 py-3 text-right font-semibold">From qty</th>
                        <th className="px-3 py-3 text-right font-semibold">Rate</th>
                        <th className="px-3 py-3 text-right font-semibold">Disc %</th>
                        <th className="px-3 py-3 text-left font-semibold">Dates</th>
                        <th className="px-3 py-3" />
                      </tr>
                    </thead>
                    <tbody>
                      {rates.map((r) => {
                        const it = itemById.get(r.item_id);
                        const v = r.variant_id ? variantById.get(r.variant_id) : null;
                        const base = v ? v.selling_price : it?.selling_price;
                        return (
                          <tr key={`${r.item_id}:${r.variant_id}:${r.min_qty}:${r.valid_from}`} className="border-b border-border/80">
                            <td className="px-4 py-2">
                              <span className="font-medium text-text-primary">{it?.name ?? 'Item'}</span>
                              {v ? <span className="text-text-secondary"> - {v.variant_name}</span> : null}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums text-text-secondary">
                              {inr(base == null ? null : Number(base))}
                              <span className="block text-xs text-text-muted">{it?.gst_included ? 'incl. GST' : 'excl. GST'}</span>
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">{r.min_qty > 0 ? r.min_qty : 'Any'}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{inr(r.price)}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{r.discount_percent ?? '—'}</td>
                            <td className="px-3 py-2 text-xs text-text-secondary">
                              {r.valid_from || r.valid_to ? `${r.valid_from ?? '…'} to ${r.valid_to ?? '…'}` : 'Always'}
                            </td>
                            <td className="whitespace-nowrap px-3 py-2 text-right">
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() =>
                                  setForm({
                                    item_id: r.item_id,
                                    variant_id: r.variant_id ?? '',
                                    min_qty: String(r.min_qty),
                                    price: r.price == null ? '' : String(r.price),
                                    discount: r.discount_percent == null ? '' : String(r.discount_percent),
                                    from: r.valid_from ?? '',
                                    to: r.valid_to ?? '',
                                  })
                                }
                              >
                                Edit
                              </Button>
                              <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void saveRate(r, true)} aria-label="Remove rate">
                                <Trash2 className="h-4 w-4" />
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

            <Card className="space-y-3 p-4">
              <h2 className="text-base font-semibold text-text-primary">Customers on this level</h2>
              <div className="flex flex-col gap-2 md:flex-row">
                <select className={selectClass} value={addCustomerId} onChange={(e) => setAddCustomerId(e.target.value)} aria-label="Customer to add">
                  <option value="">Add a customer…</option>
                  {customers
                    .filter((c) => !levelCustomers.some((lc) => lc.id === c.id))
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                </select>
                <Button type="button" variant="secondary" disabled={busy || !addCustomerId} onClick={() => void assign([addCustomerId], selected.id)}>
                  Add
                </Button>
              </div>
              {levelCustomers.length === 0 ? (
                <p className="text-sm text-text-muted">No customers yet. You can also set a customer&apos;s level on <Link href="/pricing/party-item" className="text-primary-600 hover:underline">Party item prices</Link>.</p>
              ) : (
                <ul className="flex flex-wrap gap-2">
                  {levelCustomers.map((c) => (
                    <li key={c.id} className="flex items-center gap-1 rounded-full border border-border px-3 py-1 text-sm">
                      {c.name}
                      <button type="button" className="text-text-muted hover:text-red-600" onClick={() => void assign([c.id], null)} aria-label={`Remove ${c.name}`}>
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
