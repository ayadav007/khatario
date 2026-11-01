'use client';

import { useEffect, useState } from 'react';
import { SlideOverPanel } from '@/components/ui/SlideOverPanel';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useToastContext } from '@/contexts/ToastContext';

interface Line {
  id: string;
  item_name: string;
  unit: string;
  ordered: number;
  open: number;
}

/** Goods of a bill marked "not yet arrived" reaching the godown, in full or in part. */
export function PurchaseGoodsReceiptPanel({
  purchaseId,
  items,
  open,
  onClose,
  onDone,
}: {
  purchaseId: string;
  items: any[];
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToastContext();
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [qty, setQty] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const lines: Line[] = (items || [])
    .filter((l) => l.qty_received !== null && l.qty_received !== undefined)
    .map((l) => {
      const ordered = Number(l.quantity) + Number(l.free_qty || 0);
      return { id: l.id, item_name: l.item_name, unit: l.unit, ordered, open: Math.round((ordered - Number(l.qty_received)) * 1000) / 1000 };
    })
    .filter((l) => l.open > 0);

  useEffect(() => {
    if (open) setQty(Object.fromEntries(lines.map((l) => [l.id, String(l.open)])));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    const payload = lines.map((l) => ({ purchase_item_id: l.id, qty: Number(qty[l.id]) || 0 })).filter((l) => l.qty > 0);
    if (!payload.length) {
      toast.error('Enter what arrived');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/purchases/${purchaseId}/receive-goods`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'receive', date, lines: payload }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Could not record the goods');
        return;
      }
      toast.success(data.goods_status === 'received' ? 'All goods received' : 'Goods received; the rest is still in transit');
      onDone();
      onClose();
    } catch {
      toast.error('Could not record the goods');
    } finally {
      setSaving(false);
    }
  }

  return (
    <SlideOverPanel open={open} onClose={onClose} title="Goods arrived" widthClass="max-w-lg">
      <div className="space-y-4">
        <label className="block text-sm text-gray-700">
          Arrived on
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        {lines.length === 0 && <p className="text-sm text-gray-600">Nothing on this bill is still in transit.</p>}
        {lines.map((l) => (
          <div key={l.id} className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 p-3">
            <div className="text-sm">
              <div className="font-medium text-gray-900">{l.item_name}</div>
              <div className="text-gray-600">
                {l.open} of {l.ordered} {l.unit} in transit
              </div>
            </div>
            <div className="w-28">
              <Input type="number" min={0} value={qty[l.id] ?? ''} onChange={(e) => setQty((p) => ({ ...p, [l.id]: e.target.value }))} />
            </div>
          </div>
        ))}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Close
          </Button>
          <Button onClick={save} isLoading={saving} disabled={saving || lines.length === 0}>
            Save
          </Button>
        </div>
      </div>
    </SlideOverPanel>
  );
}
