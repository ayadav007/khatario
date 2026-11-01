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
  qty: number;
  qty_open: number;
}

type Entry = { returned: string; invoiced: string; written_off: string };

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Goods coming back on a returnable challan: returned to the godown, sold to the holder where
 * they lie (approval, consignment), or lost while out (written off with GST reversed).
 */
export function ChallanReturnPanel({
  challanId,
  businessId,
  purpose,
  open,
  onClose,
  onDone,
}: {
  challanId: string;
  businessId?: string;
  purpose?: string | null;
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToastContext();
  const [lines, setLines] = useState<Line[]>([]);
  const [entries, setEntries] = useState<Record<string, Entry>>({});
  const [date, setDate] = useState(today());
  const [reason, setReason] = useState('CUSTODY_LOSS');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const canSell = purpose === 'approval' || purpose === 'consignment';

  useEffect(() => {
    if (!open) return;
    fetch(`/api/delivery-challans/${challanId}?business_id=${businessId ?? ''}`)
      .then((r) => r.json())
      .then((data) => {
        const rows: Line[] = (data.items || [])
          .filter((l: any) => l.item_id && Number(l.qty_open) > 0)
          .map((l: any) => ({ id: l.id, item_name: l.item_name, unit: l.unit, qty: Number(l.qty), qty_open: Number(l.qty_open) }));
        setLines(rows);
        setEntries(Object.fromEntries(rows.map((l) => [l.id, { returned: String(l.qty_open), invoiced: '', written_off: '' }])));
      })
      .catch(() => toast.error('Could not load the challan lines'));
  }, [open, challanId, businessId]); // eslint-disable-line react-hooks/exhaustive-deps

  const patch = (id: string, p: Partial<Entry>) => setEntries((prev) => ({ ...prev, [id]: { ...prev[id], ...p } }));

  async function save() {
    const payload = lines
      .map((l) => ({
        line_id: l.id,
        returned: Number(entries[l.id]?.returned) || 0,
        invoiced: Number(entries[l.id]?.invoiced) || 0,
        written_off: Number(entries[l.id]?.written_off) || 0,
      }))
      .filter((l) => l.returned + l.invoiced + l.written_off > 0);
    if (payload.length === 0) {
      toast.error('Enter what came back');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/delivery-challans/${challanId}/settle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ business_id: businessId, date, lines: payload, write_off_reason: reason, notes: notes || null }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Could not record the return');
        return;
      }
      toast.success(data.closed ? 'All goods are back; challan closed' : 'Return recorded');
      onDone();
      onClose();
    } catch {
      toast.error('Could not record the return');
    } finally {
      setSaving(false);
    }
  }

  const anyWriteOff = lines.some((l) => Number(entries[l.id]?.written_off) > 0);

  return (
    <SlideOverPanel open={open} onClose={onClose} title="Record goods coming back" widthClass="max-w-xl">
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        {lines.length === 0 && <p className="text-sm text-gray-600">Nothing is still out on this challan.</p>}
        {lines.map((l) => (
          <div key={l.id} className="rounded-lg border border-gray-200 p-3">
            <div className="flex justify-between text-sm">
              <span className="font-medium text-gray-900">{l.item_name}</span>
              <span className="text-gray-600">
                {l.qty_open} of {l.qty} {l.unit} still out
              </span>
            </div>
            <div className={`mt-2 grid gap-2 ${canSell ? 'grid-cols-3' : 'grid-cols-2'}`}>
              <label className="text-xs text-gray-600">
                Came back
                <Input type="number" min={0} value={entries[l.id]?.returned ?? ''} onChange={(e) => patch(l.id, { returned: e.target.value })} />
              </label>
              {canSell && (
                <label className="text-xs text-gray-600">
                  Sold to holder
                  <Input type="number" min={0} value={entries[l.id]?.invoiced ?? ''} onChange={(e) => patch(l.id, { invoiced: e.target.value })} />
                </label>
              )}
              <label className="text-xs text-gray-600">
                Lost or destroyed
                <Input type="number" min={0} value={entries[l.id]?.written_off ?? ''} onChange={(e) => patch(l.id, { written_off: e.target.value })} />
              </label>
            </div>
          </div>
        ))}
        {canSell && (
          <p className="text-xs text-gray-500">
            Goods sold to the holder come back onto the godown stock here; raise the invoice next and it takes them out.
          </p>
        )}
        {anyWriteOff && (
          <div className="grid grid-cols-1 gap-3">
            <label className="text-sm text-gray-700">
              Why they were lost
              <select
                className="mt-1 w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              >
                <option value="CUSTODY_LOSS">Lost while with the holder</option>
                <option value="DAMAGE">Damaged</option>
                <option value="THEFT">Stolen</option>
                <option value="TRANSIT_LOSS">Lost in transit</option>
              </select>
            </label>
            <label className="text-sm text-gray-700">
              Note
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What happened" />
            </label>
            <p className="text-xs text-gray-500">The loss is written off at cost and its input tax credit is reversed (s.17(5)(h)).</p>
          </div>
        )}
        <div className="flex justify-end gap-2 pt-2">
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
