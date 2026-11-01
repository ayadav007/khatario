'use client';

export const dynamic = 'force-dynamic';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Save, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Breadcrumbs } from '@/components/navigation/Breadcrumbs';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useAuth } from '@/contexts/AuthContext';
import { useToastContext } from '@/contexts/ToastContext';
import { useAuthorizationGuard } from '@/hooks/useAuthorizationGuard';
import { AccessDenied } from '@/components/common/AccessDenied';
import type { Item } from '@/types/database';

interface Scheme {
  id: string;
  item_id: string;
  variant_id: string | null;
  price_level_id: string | null;
  buy_qty: number;
  free_qty: number;
  valid_from: string | null;
  valid_to: string | null;
  is_active: boolean;
  item_name: string;
  variant_name: string | null;
  level_name: string | null;
}

interface Form {
  id: string;
  item_id: string;
  variant_id: string;
  price_level_id: string;
  buy_qty: string;
  free_qty: string;
  from: string;
  to: string;
}

const EMPTY: Form = { id: '', item_id: '', variant_id: '', price_level_id: '', buy_qty: '10', free_qty: '1', from: '', to: '' };

/** Quantity schemes: "buy 10, get 1 free". The bill adds the free units as a line at no charge. */
export default function SchemesPage() {
  const { business, user } = useAuth();
  const toast = useToastContext();
  const { allowed: canEdit, reason } = useAuthorizationGuard({
    resource: 'items',
    action: 'update',
    skipCheck: !user?.id || !business?.id,
  });

  const [schemes, setSchemes] = useState<Scheme[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [variants, setVariants] = useState<Array<{ id: string; item_id: string; variant_name: string }>>([]);
  const [levels, setLevels] = useState<Array<{ id: string; name: string }>>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<Form>(EMPTY);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    const res = await fetch('/api/pricing/schemes', { credentials: 'include' });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      setSchemes(data.schemes ?? []);
      setVariants(data.variants ?? []);
    } else toast.error(data.error || 'Failed to load schemes');
  }, [toast]);

  useEffect(() => {
    if (!business?.id || !user?.id) return;
    const qs = `business_id=${encodeURIComponent(business.id)}&user_id=${encodeURIComponent(user.id)}&limit=500`;
    setLoading(true);
    Promise.all([
      load(),
      fetch(`/api/items?${qs}`, { credentials: 'include' })
        .then((r) => (r.ok ? r.json() : {}) as Promise<any>)
        .then((d) => setItems(d.items ?? [])),
      fetch('/api/pricing/levels', { credentials: 'include' })
        .then((r) => (r.ok ? r.json() : {}) as Promise<any>)
        .then((d) => setLevels(d.levels ?? [])),
    ]).finally(() => setLoading(false));
  }, [business?.id, user?.id, load]);

  const pickable = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q ? items.filter((i) => (i.name ?? '').toLowerCase().includes(q) || (i.code ?? '').toLowerCase().includes(q)) : items;
    return list.slice(0, 200);
  }, [items, search]);
  const formVariants = variants.filter((v) => v.item_id === form.item_id);

  const save = async () => {
    if (!form.item_id) {
      toast.error('Pick an item');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/pricing/schemes', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: form.id || undefined,
          item_id: form.item_id,
          variant_id: form.variant_id || null,
          price_level_id: form.price_level_id || null,
          buy_qty: Number(form.buy_qty),
          free_qty: Number(form.free_qty),
          valid_from: form.from || null,
          valid_to: form.to || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Save failed');
      setForm(EMPTY);
      await load();
      toast.success('Scheme saved');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (s: Scheme) => {
    setBusy(true);
    try {
      const res = await fetch('/api/pricing/schemes', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...s, is_active: !s.is_active }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Save failed');
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (s: Scheme) => {
    if (!window.confirm(`Delete the scheme on ${s.item_name}?`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/pricing/schemes?id=${s.id}`, { method: 'DELETE', credentials: 'include' });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Delete failed');
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setBusy(false);
    }
  };

  if (!canEdit) return <AccessDenied module="items" action="update" details={reason} />;

  const selectClass =
    'input w-full rounded-md border border-border bg-background px-3 py-2 text-text-primary focus:outline-none focus:ring-2 focus:ring-primary-500';

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-6">
      <Breadcrumbs />
      <PageHeader
        title="Schemes"
        subtitle="Free goods on quantity, such as buy 10, get 1 free. When a bill reaches the quantity, the free units are added as their own line at no charge, so stock goes down and no GST is charged on them."
      />

      <Card className="space-y-4 p-4">
        <h2 className="text-base font-semibold text-text-primary">{form.id ? 'Change scheme' : 'New scheme'}</h2>
        <div className="grid gap-3 md:grid-cols-4">
          <label className="flex flex-col gap-1 md:col-span-2">
            <span className="text-xs font-semibold uppercase text-text-muted">Item</span>
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search items…" aria-label="Search items" />
            <select className={selectClass} value={form.item_id} onChange={(e) => setForm({ ...form, item_id: e.target.value, variant_id: '' })} aria-label="Item">
              <option value="">Select item…</option>
              {pickable.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                  {i.code ? ` (${i.code})` : ''}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold uppercase text-text-muted">Variant</span>
            <select className={selectClass} value={form.variant_id} onChange={(e) => setForm({ ...form, variant_id: e.target.value })} disabled={formVariants.length === 0}>
              <option value="">{formVariants.length ? 'All variants' : 'No variants'}</option>
              {formVariants.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.variant_name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold uppercase text-text-muted">For</span>
            <select className={selectClass} value={form.price_level_id} onChange={(e) => setForm({ ...form, price_level_id: e.target.value })}>
              <option value="">Every customer</option>
              {levels.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name} customers
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold uppercase text-text-muted">Buy</span>
            <Input type="text" inputMode="decimal" value={form.buy_qty} onChange={(e) => setForm({ ...form, buy_qty: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold uppercase text-text-muted">Get free</span>
            <Input type="text" inputMode="decimal" value={form.free_qty} onChange={(e) => setForm({ ...form, free_qty: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold uppercase text-text-muted">From</span>
            <Input type="date" value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold uppercase text-text-muted">To</span>
            <Input type="date" value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })} />
          </label>
        </div>
        <div className="flex gap-2">
          <Button type="button" onClick={() => void save()} disabled={busy} isLoading={busy}>
            <Save className="mr-2 h-4 w-4" /> Save scheme
          </Button>
          {form.id && (
            <Button type="button" variant="ghost" onClick={() => setForm(EMPTY)}>
              Cancel
            </Button>
          )}
        </div>
      </Card>

      <Card className="overflow-hidden p-0">
        {loading ? (
          <div className="flex min-h-[160px] items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-primary-600" aria-hidden />
          </div>
        ) : schemes.length === 0 ? (
          <div className="p-8 text-center text-text-secondary">No schemes yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-elevated dark:bg-slate-800/50">
                  <th className="px-4 py-3 text-left font-semibold">Item</th>
                  <th className="px-3 py-3 text-left font-semibold">Scheme</th>
                  <th className="px-3 py-3 text-left font-semibold">For</th>
                  <th className="px-3 py-3 text-left font-semibold">Dates</th>
                  <th className="px-3 py-3" />
                </tr>
              </thead>
              <tbody>
                {schemes.map((s) => (
                  <tr key={s.id} className={`border-b border-border/80 ${s.is_active ? '' : 'opacity-60'}`}>
                    <td className="px-4 py-2 font-medium text-text-primary">
                      {s.item_name}
                      {s.variant_name ? <span className="font-normal text-text-secondary"> - {s.variant_name}</span> : null}
                    </td>
                    <td className="px-3 py-2">
                      Buy {s.buy_qty}, get {s.free_qty} free
                    </td>
                    <td className="px-3 py-2 text-text-secondary">{s.level_name ? `${s.level_name} customers` : 'Everyone'}</td>
                    <td className="px-3 py-2 text-xs text-text-secondary">
                      {s.valid_from || s.valid_to ? `${s.valid_from ?? '…'} to ${s.valid_to ?? '…'}` : 'Always'}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setForm({
                            id: s.id,
                            item_id: s.item_id,
                            variant_id: s.variant_id ?? '',
                            price_level_id: s.price_level_id ?? '',
                            buy_qty: String(s.buy_qty),
                            free_qty: String(s.free_qty),
                            from: s.valid_from ?? '',
                            to: s.valid_to ?? '',
                          })
                        }
                      >
                        Edit
                      </Button>
                      <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void toggle(s)}>
                        {s.is_active ? 'Pause' : 'Resume'}
                      </Button>
                      <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void remove(s)} aria-label="Delete scheme">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
