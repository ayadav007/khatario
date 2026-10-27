'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, MessageCircle, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { ItemAutocomplete } from '@/components/ui/ItemAutocomplete';
import { useToastContext } from '@/contexts/ToastContext';

type Line = { key: string; buyer_item_id?: string; item_name: string; unit?: string; qty: string };
type SentOrder = {
  id: string;
  status: string;
  created_at: string;
  response_note: string | null;
  joined_at: string | null;
  lines: Array<{ item_name: string; unit: string | null; qty: string; confirmed_qty: string | null }>;
};

const STATUS: Record<string, { label: string; variant: 'default' | 'success' | 'warning' | 'error' }> = {
  sent: { label: 'Sent', variant: 'default' },
  viewed: { label: 'Opened', variant: 'warning' },
  confirmed: { label: 'Confirmed', variant: 'success' },
  partial: { label: 'Part confirmed', variant: 'warning' },
  declined: { label: 'Cannot supply', variant: 'error' },
  cancelled: { label: 'Withdrawn', variant: 'default' },
};

function waNumber(phone: string | null | undefined): string | null {
  const d = String(phone || '').replace(/\D/g, '');
  if (d.length === 10) return `91${d}`;
  return d.length >= 11 && d.length <= 15 ? d : null;
}

/**
 * Order from a supplier who is not on Khatario: build the list, send it as a private link from
 * your own WhatsApp, and see when they open and answer it. Joining from the link connects them.
 */
export function InviteOrderCard({ supplierId, supplierName, phone }: { supplierId: string; supplierName: string; phone?: string | null }) {
  const toast = useToastContext();
  const [lines, setLines] = useState<Line[]>([]);
  const [query, setQuery] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<SentOrder[]>([]);
  const [lastLink, setLastLink] = useState<{ link: string; message: string } | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/suppliers/hub/invite-orders?supplier_id=${supplierId}`, { cache: 'no-store' });
    if (res.ok) setSent((await res.json()).orders || []);
  }, [supplierId]);

  useEffect(() => {
    load();
  }, [load]);

  const send = async () => {
    setBusy(true);
    try {
      const res = await fetch('/api/suppliers/hub/invite-orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          supplier_id: supplierId,
          notes: notes.trim() || undefined,
          lines: lines.map((l) => ({ buyer_item_id: l.buyer_item_id, item_name: l.item_name, qty: Number(l.qty) })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not create the order');
      setLastLink({ link: data.link, message: data.message });
      const number = waNumber(data.supplier_phone || phone);
      const wa = `https://wa.me/${number ?? ''}?text=${encodeURIComponent(data.message)}`;
      window.open(wa, '_blank', 'noopener');
      setLines([]);
      setNotes('');
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not create the order');
    } finally {
      setBusy(false);
    }
  };

  const withdraw = async (id: string) => {
    const res = await fetch(`/api/suppliers/hub/invite-orders?order_id=${id}`, { method: 'DELETE' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) toast.error(data.error || 'Could not withdraw');
    await load();
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Copied');
    } catch {
      toast.error('Copy did not work. Select the link and copy it.');
    }
  };

  return (
    <div className="mb-6 space-y-3 rounded-xl border border-gray-200 p-4">
      <div>
        <p className="font-semibold text-text-primary">Order on WhatsApp</p>
        <p className="text-sm text-text-secondary">
          {supplierName} is not on Khatario. Send your order as a link from your WhatsApp; they confirm quantities there, no
          app needed, and can join to get your orders here.
        </p>
      </div>

      {lines.length > 0 && (
        <ul className="divide-y divide-gray-100">
          {lines.map((l) => (
            <li key={l.key} className="flex items-center justify-between gap-2 py-2 text-sm">
              <span className="min-w-0 truncate text-text-primary">{l.item_name}</span>
              <span className="flex items-center gap-2">
                <input
                  id={`invite-qty-${l.key}`}
                  type="number"
                  min={0}
                  step="any"
                  value={l.qty}
                  onChange={(e) => setLines((prev) => prev.map((x) => (x.key === l.key ? { ...x, qty: e.target.value } : x)))}
                  className="w-20 rounded-md border border-gray-300 px-2 py-1 text-sm"
                />
                <span className="text-text-secondary">{l.unit || ''}</span>
                <button
                  type="button"
                  aria-label={`Remove ${l.item_name}`}
                  onClick={() => setLines((prev) => prev.filter((x) => x.key !== l.key))}
                  className="text-text-secondary hover:text-red-600"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      <ItemAutocomplete
        value={query}
        onChange={setQuery}
        placeholder="Add an item to the order"
        onSelect={(item) => {
          setLines((prev) =>
            prev.some((l) => l.buyer_item_id === item.id)
              ? prev
              : [...prev, { key: item.id, buyer_item_id: item.id, item_name: item.name, unit: item.unit, qty: '1' }]
          );
          setQuery('');
        }}
      />
      <input
        id="invite-notes"
        type="text"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Note for the supplier (optional)"
        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
      />
      <Button onClick={send} disabled={busy || lines.length === 0 || lines.some((l) => !(Number(l.qty) > 0))}>
        {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <MessageCircle className="mr-2 h-4 w-4" />}
        Send order on WhatsApp
      </Button>

      {lastLink && (
        <p className="text-xs text-text-secondary">
          WhatsApp did not open?{' '}
          <button type="button" className="font-medium text-primary-600 underline" onClick={() => copy(lastLink.message)}>
            Copy the message
          </button>{' '}
          or share this link: <span className="select-all break-all">{lastLink.link}</span>
        </p>
      )}

      {sent.length > 0 && (
        <div className="space-y-2 border-t border-gray-100 pt-3">
          <p className="text-sm font-medium text-text-primary">Orders sent as links</p>
          <ul className="space-y-2">
            {sent.map((o) => (
              <li key={o.id} className="rounded-lg bg-slate-50 p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-text-secondary">
                    {new Date(o.created_at).toLocaleDateString('en-IN', { dateStyle: 'medium' })} · {o.lines.length} item
                    {o.lines.length === 1 ? '' : 's'}
                  </span>
                  <span className="flex items-center gap-2">
                    <Chip variant={STATUS[o.status]?.variant ?? 'default'}>{STATUS[o.status]?.label ?? o.status}</Chip>
                    {(o.status === 'sent' || o.status === 'viewed') && (
                      <Button size="sm" variant="ghost" onClick={() => withdraw(o.id)}>
                        Withdraw
                      </Button>
                    )}
                  </span>
                </div>
                <p className="mt-1 text-xs text-text-secondary">
                  {o.lines
                    .map((l) =>
                      l.confirmed_qty != null && Number(l.confirmed_qty) !== Number(l.qty)
                        ? `${l.item_name} ${Number(l.confirmed_qty)} of ${Number(l.qty)}`
                        : `${l.item_name} ${Number(l.qty)}`
                    )
                    .join(' · ')}
                </p>
                {o.response_note && <p className="mt-1 text-xs text-text-primary">“{o.response_note}”</p>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
