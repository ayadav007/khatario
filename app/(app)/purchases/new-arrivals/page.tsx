'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Package } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useToastContext } from '@/contexts/ToastContext';

type Listing = {
  listing_id: string;
  vendor_item_id: string;
  name: string;
  unit: string | null;
  image_url: string | null;
  price: string | null;
  moq: string | null;
  order_multiple: string | null;
  pack_label: string | null;
  lead_time_text: string | null;
  my_item_name: string | null;
};

type Collection = {
  id: string;
  name: string;
  season: string | null;
  description: string | null;
  cover_image_url: string | null;
  published_at: string;
  supplier_id: string;
  supplier_name: string;
  items: Listing[];
};

type Supplier = { supplier_id: string; business_id: string; name: string; mute_launches: boolean };

const money = (v: string | number) => `₹${Number(v).toLocaleString('en-IN')}`;

/** New collections from connected suppliers; fill a cart per supplier and send it as an order. */
export default function NewArrivalsPage() {
  const router = useRouter();
  const toast = useToastContext();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [catalog, setCatalog] = useState<Listing[]>([]);
  const [supplierId, setSupplierId] = useState('');
  const [loading, setLoading] = useState(true);
  // cart[supplier_id][vendor_item_id] = qty
  const [cart, setCart] = useState<Record<string, Record<string, string>>>({});
  const [sending, setSending] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/suppliers/hub/new-arrivals${supplierId ? `?supplier_id=${supplierId}` : ''}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load new arrivals');
      setSuppliers(data.suppliers || []);
      setCollections(data.collections || []);
      setCatalog(data.catalog || []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load new arrivals');
    } finally {
      setLoading(false);
    }
  }, [supplierId, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const selected = suppliers.find((s) => s.supplier_id === supplierId) || null;

  const setQty = (sid: string, itemId: string, qty: string) =>
    setCart((prev) => ({ ...prev, [sid]: { ...(prev[sid] || {}), [itemId]: qty } }));

  const cartBySupplier = useMemo(
    () =>
      Object.entries(cart)
        .map(([sid, items]) => ({
          sid,
          name: suppliers.find((s) => s.supplier_id === sid)?.name || 'Supplier',
          lines: Object.entries(items).filter(([, q]) => Number(q) > 0),
        }))
        .filter((c) => c.lines.length > 0),
    [cart, suppliers]
  );

  const send = async (sid: string) => {
    const lines = Object.entries(cart[sid] || {})
      .filter(([, q]) => Number(q) > 0)
      .map(([vendor_item_id, q]) => ({ vendor_item_id, qty: Number(q) }));
    setSending(sid);
    try {
      const res = await fetch('/api/supply-orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ supplier_id: sid, from_catalog: true, lines }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to send the order');
      setCart((prev) => ({ ...prev, [sid]: {} }));
      toast.success('Order sent');
      router.push(`/supply-orders/${data.order.id}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to send the order');
    } finally {
      setSending(null);
    }
  };

  const toggleMute = async () => {
    if (!selected) return;
    const res = await fetch('/api/suppliers/hub/mute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ supplier_id: selected.supplier_id, muted: !selected.mute_launches }),
    });
    if (res.ok) {
      toast.success(selected.mute_launches ? 'Launch alerts on' : 'Launch alerts off');
      await load();
    } else toast.error('Failed to save');
  };

  const renderItem = (sid: string, l: Listing) => {
    const moq = Number(l.moq) || 0;
    const step = Number(l.order_multiple) || 0;
    return (
      <li key={l.listing_id} className="flex gap-3 rounded-lg border border-gray-100 p-3">
        <div className="h-20 w-20 shrink-0 overflow-hidden rounded-md bg-gray-50">
          {l.image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={l.image_url} alt={l.name} className="h-full w-full object-cover" loading="lazy" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-gray-300">
              <Package className="h-8 w-8" />
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <p className="truncate font-medium text-text-primary">{l.name}</p>
          <p className="text-xs text-text-secondary">
            {l.price != null ? `${money(l.price)} per ${l.unit || 'unit'}` : 'Price on request'}
            {l.pack_label ? ` · ${l.pack_label}` : ''}
          </p>
          <p className="text-xs text-text-secondary">
            {[moq ? `Min ${moq}` : null, step ? `In ${step}s` : null, l.lead_time_text, l.my_item_name ? `Your item: ${l.my_item_name}` : null]
              .filter(Boolean)
              .join(' · ')}
          </p>
          <input
            type="number"
            min={0}
            step={step || 'any'}
            inputMode="decimal"
            placeholder={moq ? String(moq) : '0'}
            className="w-24 rounded-md border border-gray-300 px-2 py-1 text-sm"
            value={cart[sid]?.[l.vendor_item_id] ?? ''}
            onChange={(e) => setQty(sid, l.vendor_item_id, e.target.value)}
          />
        </div>
      </li>
    );
  };

  return (
    <div className="space-y-4 pb-24">
      <PageHeader
        title="New arrivals"
        subtitle="New collections from your connected suppliers. Add quantities and send the order to the supplier to confirm."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <select
              className="rounded-md border border-gray-300 px-2 py-2 text-sm"
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
            >
              <option value="">All suppliers</option>
              {suppliers.map((s) => (
                <option key={s.supplier_id} value={s.supplier_id}>
                  {s.name}
                </option>
              ))}
            </select>
            {selected && (
              <Button variant="ghost" onClick={toggleMute}>
                {selected.mute_launches ? 'Turn launch alerts on' : 'Mute launch alerts'}
              </Button>
            )}
          </div>
        }
      />

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-primary-500" />
        </div>
      ) : collections.length === 0 && catalog.length === 0 ? (
        <Card padding="md">
          <p className="py-8 text-center text-sm text-text-secondary">
            {suppliers.length === 0
              ? 'Connect with suppliers in the Suppliers Hub to see their new collections here.'
              : 'No new collections yet.'}
          </p>
        </Card>
      ) : (
        <>
          {collections.map((c) => (
            <Card key={c.id} padding="md" className="space-y-3">
              <div className="flex flex-wrap items-start gap-3">
                {c.cover_image_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={c.cover_image_url} alt="" className="h-16 w-16 rounded-md object-cover" loading="lazy" />
                )}
                <div className="min-w-0 flex-1">
                  <h2 className="font-semibold text-text-primary">{c.name}</h2>
                  <p className="text-xs text-text-secondary">
                    {c.supplier_name}
                    {c.season ? ` · ${c.season}` : ''} · {new Date(c.published_at).toLocaleDateString('en-IN')}
                  </p>
                  {c.description && <p className="mt-1 text-sm text-text-secondary">{c.description}</p>}
                </div>
              </div>
              <ul className="grid gap-3 sm:grid-cols-2">{c.items.map((l) => renderItem(c.supplier_id, l))}</ul>
            </Card>
          ))}
          {catalog.length > 0 && selected && (
            <Card padding="md" className="space-y-3">
              <h2 className="font-semibold text-text-primary">More from {selected.name}</h2>
              <ul className="grid gap-3 sm:grid-cols-2">{catalog.map((l) => renderItem(selected.supplier_id, l))}</ul>
            </Card>
          )}
        </>
      )}

      {cartBySupplier.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-gray-200 bg-white p-3 shadow-lg">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-2">
            {cartBySupplier.map((c) => (
              <Button key={c.sid} onClick={() => send(c.sid)} disabled={sending === c.sid}>
                {sending === c.sid ? 'Sending…' : `Order ${c.lines.length} item${c.lines.length === 1 ? '' : 's'} from ${c.name}`}
              </Button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
