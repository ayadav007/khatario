'use client';

import { useEffect, useState } from 'react';
import { SlideOverPanel } from '@/components/ui/SlideOverPanel';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useToastContext } from '@/contexts/ToastContext';

const SUB_SUPPLY: Array<{ value: string; label: string }> = [
  { value: 'supply', label: 'Supply' },
  { value: 'job_work', label: 'Job work' },
  { value: 'job_work_returns', label: 'Job work returns' },
  { value: 'sales_return', label: 'Sales return' },
  { value: 'exhibition', label: 'Exhibition or fairs' },
  { value: 'line_sales', label: 'Line sales' },
  { value: 'own_use', label: 'For own use' },
  { value: 'recipient_not_known', label: 'Recipient not known' },
  { value: 'skd_ckd', label: 'SKD/CKD' },
  { value: 'export', label: 'Export' },
  { value: 'import', label: 'Import' },
  { value: 'others', label: 'Others' },
];

const nowLocal = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};

/** Records an e-way bill generated on the GST portal against a document. */
export function EwayBillPanel({
  open,
  onClose,
  onDone,
  sourceType,
  sourceId,
  defaults,
  inward = false,
}: {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
  sourceType: 'invoice' | 'delivery_challan' | 'stock_transfer' | 'purchase';
  sourceId: string;
  defaults?: { doc_type?: string; sub_supply_type?: string; goods_value?: number; vehicle_number?: string | null };
  /** The supplier generated it for goods coming to us. */
  inward?: boolean;
}) {
  const toast = useToastContext();
  const [form, setForm] = useState({
    ewb_number: '',
    generated_at: nowLocal(),
    distance_km: '',
    is_odc: false,
    doc_type: defaults?.doc_type || 'tax_invoice',
    sub_supply_type: defaults?.sub_supply_type || 'supply',
    goods_value: defaults?.goods_value ? String(defaults.goods_value) : '',
    vehicle_number: defaults?.vehicle_number || '',
    transporter_name: '',
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setForm((f) => ({ ...f, generated_at: nowLocal() }));
  }, [open]);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch('/api/eway-bills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_type: sourceType,
          source_id: sourceId,
          direction: inward ? 'inward' : 'outward',
          ewb_number: form.ewb_number.trim(),
          generated_at: new Date(form.generated_at).toISOString(),
          distance_km: Number(form.distance_km),
          is_odc: form.is_odc,
          doc_type: form.doc_type,
          sub_supply_type: form.sub_supply_type,
          goods_value: Number(form.goods_value) || 0,
          vehicle_number: form.vehicle_number || null,
          transporter_name: form.transporter_name || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Could not record the e-way bill');
        return;
      }
      const until = data.eway_bill.valid_until ? new Date(data.eway_bill.valid_until).toLocaleString('en-IN') : '';
      toast.success(`E-way bill recorded${until ? `, valid until ${until}` : ''}`);
      onDone();
      onClose();
    } catch {
      toast.error('Could not record the e-way bill');
    } finally {
      setSaving(false);
    }
  }

  return (
    <SlideOverPanel open={open} onClose={onClose} title="Record e-way bill" widthClass="max-w-md">
      <div className="space-y-3">
        <label className="block text-sm text-gray-700">
          E-way bill number (12 digits)
          <Input value={form.ewb_number} inputMode="numeric" maxLength={12} onChange={(e) => setForm({ ...form, ewb_number: e.target.value })} />
        </label>
        <label className="block text-sm text-gray-700">
          Generated on
          <Input type="datetime-local" value={form.generated_at} onChange={(e) => setForm({ ...form, generated_at: e.target.value })} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm text-gray-700">
            Distance (km)
            <Input type="number" min={0} value={form.distance_km} onChange={(e) => setForm({ ...form, distance_km: e.target.value })} />
          </label>
          <label className="block text-sm text-gray-700">
            Goods value (₹)
            <Input type="number" min={0} value={form.goods_value} onChange={(e) => setForm({ ...form, goods_value: e.target.value })} />
          </label>
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={form.is_odc} onChange={(e) => setForm({ ...form, is_odc: e.target.checked })} />
          Over-dimensional cargo (20 km a day)
        </label>
        <label className="block text-sm text-gray-700">
          Document type
          <select className="mt-1 w-full border border-gray-300 rounded-md px-3 py-2 text-sm" value={form.doc_type} onChange={(e) => setForm({ ...form, doc_type: e.target.value })}>
            <option value="tax_invoice">Tax invoice</option>
            <option value="bill_of_supply">Bill of supply</option>
            <option value="delivery_challan">Delivery challan</option>
            <option value="bill_of_entry">Bill of entry</option>
            <option value="credit_note">Credit note</option>
            <option value="others">Others</option>
          </select>
        </label>
        <label className="block text-sm text-gray-700">
          Sub-supply type
          <select
            className="mt-1 w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
            value={form.sub_supply_type}
            onChange={(e) => setForm({ ...form, sub_supply_type: e.target.value })}
          >
            {SUB_SUPPLY.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm text-gray-700">
            Vehicle number
            <Input value={form.vehicle_number} onChange={(e) => setForm({ ...form, vehicle_number: e.target.value })} />
          </label>
          <label className="block text-sm text-gray-700">
            Transporter
            <Input value={form.transporter_name} onChange={(e) => setForm({ ...form, transporter_name: e.target.value })} />
          </label>
        </div>
        <p className="text-xs text-gray-500">Valid for one day per 200 km, ending at midnight. The number is also printed on the document.</p>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Close
          </Button>
          <Button onClick={save} isLoading={saving} disabled={saving || form.ewb_number.trim().length !== 12 || form.distance_km === ''}>
            Save
          </Button>
        </div>
      </div>
    </SlideOverPanel>
  );
}
