'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useToastContext } from '@/contexts/ToastContext';

type Row = { id: string; name: string; unit: string | null; selling_price: string | null; buyer_price: string | null };

const inr = (v: string | number | null) =>
  v == null || v === '' ? '-' : `₹${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

/**
 * Supplier side: prices for one connected buyer. They apply to that buyer's orders, catalogue
 * and New arrivals, and pre-fill the bill; leave a price empty to use your normal price.
 */
export default function BuyerPricesPage({ params }: { params: { customerId: string } }) {
  const toast = useToastContext();
  const [buyer, setBuyer] = useState<{ name: string } | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [q, setQ] = useState('');
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/suppliers/hub/buyer-prices?customer_id=${params.customerId}&q=${encodeURIComponent(q)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to load prices');
      setBuyer(data.buyer);
      setRows(data.items || []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load prices');
    } finally {
      setLoading(false);
    }
  }, [params.customerId, q, toast]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  const save = async (row: Row) => {
    const value = edits[row.id];
    setSaving(row.id);
    try {
      const res = await fetch('/api/suppliers/hub/buyer-prices', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customer_id: params.customerId, item_id: row.id, price: value === '' ? null : value }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to save');
      setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, buyer_price: data.price == null ? null : String(data.price) } : r)));
      setEdits((prev) => {
        const next = { ...prev };
        delete next[row.id];
        return next;
      });
      toast.success(data.price == null ? `${row.name} back to your normal price` : `Price saved for ${row.name}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title={buyer ? `Prices for ${buyer.name}` : 'Prices for this buyer'}
        subtitle="Used on their orders, your catalogue and New arrivals, and the bill. Empty means your normal price."
        actions={
          <Link href={`/customers/${params.customerId}`}>
            <Button variant="secondary">Back to customer</Button>
          </Link>
        }
      />
      <input
        id="buyer-price-search"
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search your items"
        className="w-full max-w-md rounded-md border border-gray-300 px-3 py-2 text-sm"
      />
      <Card padding="md">
        {loading ? (
          <Loader2 className="h-6 w-6 animate-spin text-primary-500" />
        ) : rows.length === 0 ? (
          <p className="text-sm text-text-secondary">No items match.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {rows.map((r) => {
              const value = edits[r.id] ?? (r.buyer_price == null ? '' : String(Number(r.buyer_price)));
              const changed = edits[r.id] !== undefined;
              return (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="font-medium text-text-primary">{r.name}</p>
                    <p className="text-xs text-text-secondary">
                      Normal price {inr(r.selling_price)}
                      {r.unit ? ` / ${r.unit}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="sr-only" htmlFor={`price-${r.id}`}>
                      Price for this buyer
                    </label>
                    <input
                      id={`price-${r.id}`}
                      type="number"
                      min={0}
                      step="any"
                      value={value}
                      placeholder="Normal"
                      onChange={(e) => setEdits((prev) => ({ ...prev, [r.id]: e.target.value }))}
                      className="w-28 rounded-md border border-gray-300 px-2 py-1 text-sm"
                    />
                    <Button size="sm" onClick={() => save(r)} disabled={!changed || saving === r.id}>
                      Save
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
