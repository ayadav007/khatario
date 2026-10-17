'use client';

import React, { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { ItemAutocomplete } from '@/components/ui/ItemAutocomplete';
import { useToastContext } from '@/contexts/ToastContext';

type Line = { itemId: string; name: string; unit: string | null; stock: number; level: number; qty: string };

/** Suggested order quantity in the buyer's unit (mirrors lib/supply-orders suggestedBuyerQty). */
function suggest(stock: number, min: number): number {
  return Math.max(1, Math.round(Math.max(min * 2 - Math.max(stock, 0), min) * 1000) / 1000);
}

function NewSupplyOrder() {
  const router = useRouter();
  const toast = useToastContext();
  const supplierId = useSearchParams().get('supplier_id') || '';
  const [supplierName, setSupplierName] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [query, setQuery] = useState('');
  const [needBy, setNeedBy] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Start from this supplier's items that are at or below their reorder level.
  useEffect(() => {
    if (!supplierId) return;
    (async () => {
      try {
        const res = await fetch(`/api/suppliers/${supplierId}/items?filter=assigned`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to load items');
        setSupplierName(data.supplier?.name || '');
        setLines(
          (data.items || [])
            .filter((r: any) => Number(r.min_stock) > 0 && Number(r.current_stock) <= Number(r.min_stock))
            .map((r: any) => ({
              itemId: r.id,
              name: r.name,
              unit: r.unit,
              stock: Number(r.current_stock),
              level: Number(r.min_stock),
              qty: String(suggest(Number(r.current_stock), Number(r.min_stock))),
            }))
        );
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Failed to load items');
      } finally {
        setLoading(false);
      }
    })();
  }, [supplierId, toast]);

  const submit = async () => {
    const valid = lines.filter((l) => Number(l.qty) > 0);
    if (!valid.length) {
      toast.error('Add at least one item with a quantity');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/supply-orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          supplier_id: supplierId,
          need_by: needBy || null,
          notes,
          lines: valid.map((l) => ({ buyer_item_id: l.itemId, buyer_qty: Number(l.qty) })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to send the order');
      toast.success('Order sent');
      router.push(`/supply-orders/${data.order.id}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to send the order');
    } finally {
      setSaving(false);
    }
  };

  if (!supplierId) return <div className="p-6 text-center">Open this from a connected supplier.</div>;

  return (
    <div className="space-y-4">
      <PageHeader
        title={supplierName ? `Order from ${supplierName}` : 'New order'}
        subtitle="Quantities are in your units. Items you have matched to the supplier's are converted to their packs."
        actions={
          <Link href={`/suppliers/${supplierId}`}>
            <Button variant="secondary">Back</Button>
          </Link>
        }
      />
      <Card padding="md" className="space-y-3">
        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-primary-500" />
          </div>
        ) : (
          <>
            {lines.length === 0 && (
              <p className="text-sm text-text-secondary">Nothing from this supplier is low. Add items below.</p>
            )}
            <ul className="divide-y divide-gray-100">
              {lines.map((l, i) => (
                <li key={l.itemId} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-text-primary">{l.name}</p>
                    <p className="text-xs text-text-secondary">
                      In stock {l.stock}
                      {l.level ? ` · reorder at ${l.level}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={0}
                      step="any"
                      className="w-24 rounded-md border border-gray-300 px-2 py-1 text-sm"
                      value={l.qty}
                      onChange={(e) => setLines((prev) => prev.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))}
                    />
                    <span className="text-xs text-text-secondary">{l.unit || 'units'}</span>
                    <Button size="sm" variant="ghost" onClick={() => setLines((prev) => prev.filter((_, j) => j !== i))}>
                      Remove
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
            <ItemAutocomplete
              value={query}
              onChange={setQuery}
              placeholder="Add another item"
              onSelect={(item) => {
                setQuery('');
                if (lines.some((l) => l.itemId === item.id)) return;
                setLines((prev) => [
                  ...prev,
                  { itemId: item.id, name: item.name, unit: item.unit ?? null, stock: Number(item.current_stock) || 0, level: 0, qty: '1' },
                ]);
              }}
            />
          </>
        )}
      </Card>
      <Card padding="md" className="space-y-3">
        <div className="flex flex-wrap gap-4">
          <label className="text-sm text-text-secondary">
            Needed by (optional)
            <input
              type="date"
              className="mt-1 block rounded-md border border-gray-300 px-2 py-1 text-sm"
              value={needBy}
              onChange={(e) => setNeedBy(e.target.value)}
            />
          </label>
          <label className="min-w-[14rem] flex-1 text-sm text-text-secondary">
            Note to supplier (optional)
            <input
              className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1 text-sm"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </label>
        </div>
        <Button onClick={submit} disabled={saving || loading}>
          {saving ? 'Sending…' : 'Send order to supplier'}
        </Button>
      </Card>
    </div>
  );
}

export default function NewSupplyOrderPage() {
  return (
    <Suspense fallback={<div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-primary-500" /></div>}>
      <NewSupplyOrder />
    </Suspense>
  );
}
