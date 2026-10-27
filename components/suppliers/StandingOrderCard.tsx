'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { ItemAutocomplete } from '@/components/ui/ItemAutocomplete';
import { useToastContext } from '@/contexts/ToastContext';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
type Standing = {
  id: string;
  status: 'proposed' | 'active' | 'paused';
  weekdays: number[];
  other_business_id: string;
  last_run_on: string | null;
  lines: Array<{ item_name: string; qty: string }>;
};
type Line = { id: string; name: string; unit?: string; qty: string };

const STATUS: Record<string, { label: string; variant: 'default' | 'success' | 'warning' }> = {
  proposed: { label: 'Waiting for supplier', variant: 'warning' },
  active: { label: 'Running', variant: 'success' },
  paused: { label: 'Paused', variant: 'default' },
};

/** Same order on fixed days (milk, bread, papers): propose once, then it arrives confirmed. */
export function StandingOrderCard({ supplierId, vendorBusinessId }: { supplierId: string; vendorBusinessId: string }) {
  const toast = useToastContext();
  const [list, setList] = useState<Standing[]>([]);
  const [open, setOpen] = useState(false);
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5, 6]);
  const [lines, setLines] = useState<Line[]>([]);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch('/api/supply-orders/standing?role=buyer', { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      setList((data.standing || []).filter((s: Standing) => s.other_business_id === vendorBusinessId));
    }
  }, [vendorBusinessId]);

  useEffect(() => {
    load();
  }, [load]);

  const create = async () => {
    setBusy(true);
    try {
      const res = await fetch('/api/supply-orders/standing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          supplier_id: supplierId,
          weekdays: days,
          lines: lines.map((l) => ({ buyer_item_id: l.id, buyer_qty: Number(l.qty) })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not create the standing order');
      toast.success('Sent to the supplier to accept');
      setOpen(false);
      setLines([]);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not create the standing order');
    } finally {
      setBusy(false);
    }
  };

  const act = async (id: string, action: 'pause' | 'resume' | 'end') => {
    const res = await fetch(`/api/supply-orders/standing/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) toast.error(data.error || 'Could not update');
    await load();
  };

  return (
    <div className="mt-3 space-y-2 rounded-lg bg-slate-50 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-text-primary">Standing orders</p>
        {!open && (
          <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
            New standing order
          </Button>
        )}
      </div>
      {list.length === 0 && !open && (
        <p className="text-xs text-text-secondary">For goods you buy on fixed days, like milk or bread. Each day&apos;s order arrives confirmed.</p>
      )}
      {list.map((s) => (
        <div key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-white p-2 text-sm">
          <span className="min-w-0 text-text-primary">
            {s.lines.map((l) => `${l.item_name} ${Number(l.qty)}`).join(', ')} ·{' '}
            {s.weekdays.length === 7 ? 'every day' : s.weekdays.map((d) => DAYS[d]).join(', ')}
          </span>
          <span className="flex items-center gap-2">
            <Chip variant={STATUS[s.status]?.variant ?? 'default'}>{STATUS[s.status]?.label ?? s.status}</Chip>
            {s.status === 'active' && (
              <Button size="sm" variant="ghost" onClick={() => act(s.id, 'pause')}>
                Pause
              </Button>
            )}
            {s.status === 'paused' && (
              <Button size="sm" variant="ghost" onClick={() => act(s.id, 'resume')}>
                Resume
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => act(s.id, 'end')}>
              End
            </Button>
          </span>
        </div>
      ))}
      {open && (
        <div className="space-y-2 rounded-md bg-white p-3">
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Days">
            {DAYS.map((d, i) => (
              <button
                key={d}
                type="button"
                aria-pressed={days.includes(i)}
                onClick={() => setDays((prev) => (prev.includes(i) ? prev.filter((x) => x !== i) : [...prev, i]))}
                className={`rounded-full px-3 py-1 text-xs font-medium ${days.includes(i) ? 'bg-primary-600 text-white' : 'bg-gray-100 text-text-secondary'}`}
              >
                {d}
              </button>
            ))}
          </div>
          {lines.map((l) => (
            <div key={l.id} className="flex items-center justify-between gap-2 text-sm">
              <span className="min-w-0 truncate">{l.name}</span>
              <span className="flex items-center gap-2">
                <input
                  id={`standing-qty-${l.id}`}
                  type="number"
                  min={0}
                  step="any"
                  value={l.qty}
                  onChange={(e) => setLines((prev) => prev.map((x) => (x.id === l.id ? { ...x, qty: e.target.value } : x)))}
                  className="w-20 rounded-md border border-gray-300 px-2 py-1 text-sm"
                />
                <span className="text-text-secondary">{l.unit || ''}</span>
                <button type="button" aria-label={`Remove ${l.name}`} onClick={() => setLines((prev) => prev.filter((x) => x.id !== l.id))}>
                  <Trash2 className="h-4 w-4 text-text-secondary" />
                </button>
              </span>
            </div>
          ))}
          <ItemAutocomplete
            value={query}
            onChange={setQuery}
            placeholder="Add an item"
            onSelect={(item) => {
              setLines((prev) => (prev.some((l) => l.id === item.id) ? prev : [...prev, { id: item.id, name: item.name, unit: item.unit, qty: '1' }]));
              setQuery('');
            }}
          />
          <div className="flex gap-2">
            <Button size="sm" onClick={create} disabled={busy || !lines.length || !days.length || lines.some((l) => !(Number(l.qty) > 0))}>
              Send to supplier
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
