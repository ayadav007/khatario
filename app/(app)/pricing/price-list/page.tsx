'use client';

export const dynamic = 'force-dynamic';

import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { format } from 'date-fns';
import { Loader2, Printer } from 'lucide-react';
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
import { downloadText, toCsv } from '@/lib/pricing/rate-csv';

interface Line {
  item: Item;
  variantId: string | null;
  variantName: string | null;
  price: number | null;
  priceSource: 'party' | 'level' | 'catalog';
  discountPercent: number | null;
  gstIncluded: boolean;
  taxRate: number;
  mrp: number | null;
  scheme: { buyQty: number; freeQty: number } | null;
}

const inr = (n: number | null) =>
  n == null ? '—' : `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** What a customer pays per item on a date, ready to print or send: their price, level rate or item price. */
export default function PriceListPage() {
  const { business, user } = useAuth();
  const toast = useToastContext();
  const searchParams = useSearchParams();
  const { allowed, reason } = useAuthorizationGuard({ resource: 'items', action: 'read', skipCheck: !user?.id || !business?.id });

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [customerId, setCustomerId] = useState(searchParams.get('customer_id') || '');
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [lines, setLines] = useState<Line[]>([]);
  const [loading, setLoading] = useState(false);
  const [onlySpecial, setOnlySpecial] = useState(false);

  useEffect(() => {
    if (!business?.id || !user?.id) return;
    const qs = `business_id=${encodeURIComponent(business.id)}&user_id=${encodeURIComponent(user.id)}&limit=500`;
    Promise.all([
      fetch(`/api/customers?${qs}`, { credentials: 'include' }).then((r) => (r.ok ? r.json() : {}) as Promise<any>),
      fetch(`/api/items?${qs}`, { credentials: 'include' }).then((r) => (r.ok ? r.json() : {}) as Promise<any>),
    ]).then(([c, i]) => {
      setCustomers(c.customers ?? []);
      setItems((i.items ?? []).filter((it: Item) => it.is_active !== false));
    });
  }, [business?.id, user?.id]);

  useEffect(() => {
    if (items.length === 0) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        // Variant rows come from the customer price API, which lists the business's variants.
        let variants: Array<{ id: string; item_id: string; variant_name: string }> = [];
        if (customerId) {
          const v = await fetch(`/api/pricing/party-item?party_id=${encodeURIComponent(customerId)}`, { credentials: 'include' });
          if (v.ok) variants = (await v.json()).variants ?? [];
        }
        const wanted: Array<{ item: Item; variantId: string | null; variantName: string | null }> = [];
        for (const it of items) {
          const vs = variants.filter((v) => v.item_id === it.id);
          if (vs.length) for (const v of vs) wanted.push({ item: it, variantId: v.id, variantName: v.variant_name });
          else wanted.push({ item: it, variantId: null, variantName: null });
        }
        const out: Line[] = [];
        for (let i = 0; i < wanted.length; i += 300) {
          const chunk = wanted.slice(i, i + 300);
          const res = await fetch('/api/pricing/resolve', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              customer_id: customerId || null,
              date,
              lines: chunk.map((w) => ({ item_id: w.item.id, variant_id: w.variantId, qty: 1 })),
            }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Could not load prices');
          (data.lines ?? []).forEach((r: any, k: number) => out.push({ ...chunk[k], ...r }));
        }
        if (!cancelled) setLines(out);
      } catch (e) {
        if (!cancelled) toast.error(e instanceof Error ? e.message : 'Could not load prices');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [items, customerId, date, toast]);

  const shown = useMemo(
    () => (onlySpecial ? lines.filter((l) => l.priceSource !== 'catalog' || l.discountPercent != null || l.scheme) : lines),
    [lines, onlySpecial]
  );
  const customer = customers.find((c) => c.id === customerId);
  const net = (l: Line) => (l.price == null ? null : Math.round(l.price * (1 - (l.discountPercent ?? 0) / 100) * 100) / 100);

  const exportCsv = () => {
    const rows: unknown[][] = [['item_code', 'item_name', 'variant', 'unit', 'mrp', 'rate', 'discount_percent', 'net_rate', 'gst_percent', 'rate_includes_gst', 'scheme']];
    for (const l of shown) {
      rows.push([
        l.item.code ?? '',
        l.item.name,
        l.variantName ?? '',
        l.item.unit,
        l.mrp ?? '',
        l.price ?? '',
        l.discountPercent ?? '',
        net(l) ?? '',
        l.taxRate,
        l.gstIncluded ? 'yes' : 'no',
        l.scheme ? `buy ${l.scheme.buyQty} get ${l.scheme.freeQty} free` : '',
      ]);
    }
    downloadText(`price-list-${(customer?.name ?? 'all').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${date}.csv`, toCsv(rows));
  };

  if (!allowed) return <AccessDenied module="items" action="read" details={reason} />;

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-6 print:max-w-none print:p-0">
      <div className="print:hidden">
        <Breadcrumbs />
        <PageHeader title="Price list" subtitle="What a customer pays per item on a date: their own price, their price level's rate, or the item price. Print it or download it to send." />
      </div>

      <Card className="flex flex-col gap-3 p-4 md:flex-row md:items-end print:hidden">
        <label className="flex flex-1 flex-col gap-1">
          <span className="text-xs font-semibold uppercase text-text-muted">Customer</span>
          <select
            className="input rounded-md border border-border bg-background px-3 py-2 text-text-primary"
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
          >
            <option value="">Everyone (item prices)</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold uppercase text-text-muted">Prices on</span>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="flex items-center gap-2 text-sm text-text-secondary">
          <input type="checkbox" checked={onlySpecial} onChange={(e) => setOnlySpecial(e.target.checked)} />
          Only special prices
        </label>
        <div className="flex gap-2">
          <Button type="button" variant="secondary" onClick={exportCsv} disabled={loading || shown.length === 0}>
            Download CSV
          </Button>
          <Button type="button" onClick={() => window.print()} disabled={loading || shown.length === 0}>
            <Printer className="mr-2 h-4 w-4" /> Print
          </Button>
        </div>
      </Card>

      <div className="hidden print:block">
        <h1 className="text-xl font-bold">{business?.name}</h1>
        <p className="text-sm">
          Price list{customer ? ` for ${customer.name}` : ''} · valid on {date}
        </p>
      </div>

      <Card className="overflow-hidden p-0 print:border-0 print:shadow-none">
        {loading ? (
          <div className="flex min-h-[200px] items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-primary-600" aria-hidden />
          </div>
        ) : shown.length === 0 ? (
          <div className="p-8 text-center text-text-secondary">No items.</div>
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-elevated dark:bg-slate-800/50 print:bg-transparent">
                <th className="px-4 py-2 text-left font-semibold">Item</th>
                <th className="px-3 py-2 text-right font-semibold">MRP</th>
                <th className="px-3 py-2 text-right font-semibold">Rate</th>
                <th className="px-3 py-2 text-right font-semibold">Disc</th>
                <th className="px-3 py-2 text-right font-semibold">Net rate</th>
                <th className="px-3 py-2 text-right font-semibold">GST</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((l) => (
                <tr key={`${l.item.id}:${l.variantId ?? ''}`} className="border-b border-border/70 break-inside-avoid">
                  <td className="px-4 py-1.5">
                    <span className="font-medium">{l.item.name}</span>
                    {l.variantName ? ` - ${l.variantName}` : ''}
                    <span className="text-xs text-text-muted"> / {l.item.unit}</span>
                    {l.scheme ? (
                      <span className="block text-xs text-emerald-700">
                        Buy {l.scheme.buyQty}, get {l.scheme.freeQty} free
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{inr(l.mrp)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{inr(l.price)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{l.discountPercent != null ? `${l.discountPercent}%` : '—'}</td>
                  <td className="px-3 py-1.5 text-right font-semibold tabular-nums">
                    {inr(net(l))}
                    <span className="block text-[10px] font-normal text-text-muted">{l.gstIncluded ? 'incl. GST' : '+ GST'}</span>
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{l.taxRate}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
