'use client';

import { useEffect, useState } from 'react';
import { SlideOverPanel } from '@/components/ui/SlideOverPanel';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useToastContext } from '@/contexts/ToastContext';

interface Line {
  item_id: string;
  item_name: string;
  open: number;
}

/**
 * Part of a transfer that never arrived: written off as a transit loss (GST credit reversed),
 * or written off and claimed from the carrier.
 */
export function TransferShortfallPanel({
  transferId,
  businessId,
  items,
  open,
  onClose,
  onDone,
}: {
  transferId: string;
  businessId?: string;
  items: any[];
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToastContext();
  const lines: Line[] = (items || [])
    .map((i) => ({
      item_id: i.item_id,
      item_name: i.item_name || 'Item',
      open:
        Math.round((Number(i.quantity_dispatched || 0) - Number(i.received_qty || 0) - Number(i.qty_short || 0)) * 1000) / 1000,
    }))
    .filter((l) => l.open > 0);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [reason, setReason] = useState<'transit_loss' | 'carrier_claim'>('transit_loss');
  const [carrier, setCarrier] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setQty(Object.fromEntries(lines.map((l) => [l.item_id, String(l.open)])));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    const payload = lines
      .map((l) => ({
        item_id: l.item_id,
        qty: Number(qty[l.item_id]) || 0,
        reason,
        claim_party: reason === 'carrier_claim' ? carrier : null,
        claim_amount: reason === 'carrier_claim' && amount ? Number(amount) : null,
      }))
      .filter((l) => l.qty > 0);
    if (!payload.length) {
      toast.error('Enter the quantity that never arrived');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/stock-transfers/${transferId}/close-short`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ business_id: businessId, date, lines: payload }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Could not close the shortfall');
        return;
      }
      toast.success(data.completed ? 'Shortfall written off; transfer completed' : 'Shortfall written off');
      onDone();
      onClose();
    } catch {
      toast.error('Could not close the shortfall');
    } finally {
      setSaving(false);
    }
  }

  return (
    <SlideOverPanel open={open} onClose={onClose} title="Close shortfall" widthClass="max-w-lg">
      <div className="space-y-4">
        <p className="text-sm text-gray-600">
          Goods that left the source godown and will not arrive. They are written off as a transit loss and their input tax credit is
          reversed.
        </p>
        <label className="block text-sm text-gray-700">
          Date
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        {lines.length === 0 && <p className="text-sm text-gray-600">Nothing is still in transit on this transfer.</p>}
        {lines.map((l) => (
          <div key={l.item_id} className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 p-3">
            <div className="text-sm">
              <div className="font-medium text-gray-900">{l.item_name}</div>
              <div className="text-gray-600">{l.open} still in transit</div>
            </div>
            <div className="w-28">
              <Input type="number" min={0} value={qty[l.item_id] ?? ''} onChange={(e) => setQty((p) => ({ ...p, [l.item_id]: e.target.value }))} />
            </div>
          </div>
        ))}
        <label className="block text-sm text-gray-700">
          What happened
          <select
            className="mt-1 w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
            value={reason}
            onChange={(e) => setReason(e.target.value as 'transit_loss' | 'carrier_claim')}
          >
            <option value="transit_loss">Lost in transit</option>
            <option value="carrier_claim">Lost; claimed from the carrier</option>
          </select>
        </label>
        {reason === 'carrier_claim' && (
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm text-gray-700">
              Carrier
              <Input value={carrier} onChange={(e) => setCarrier(e.target.value)} />
            </label>
            <label className="block text-sm text-gray-700">
              Claim amount (₹)
              <Input type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} />
            </label>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Close
          </Button>
          <Button onClick={save} isLoading={saving} disabled={saving || lines.length === 0}>
            Write off
          </Button>
        </div>
      </div>
    </SlideOverPanel>
  );
}
