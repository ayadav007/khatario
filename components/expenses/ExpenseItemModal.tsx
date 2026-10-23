'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useToastContext } from '@/contexts/ToastContext';
import { GST_RATE_SLABS } from '@/lib/gst/rates';

const RATE_OPTIONS = [...GST_RATE_SLABS, 28];

export type CreatedExpenseItem = {
  id: string;
  name: string;
  item_type: 'goods' | 'service';
  unit: string | null;
  hsn_sac: string | null;
  tax_rate: number;
};

export function ExpenseItemModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (item: CreatedExpenseItem) => void;
}) {
  const toast = useToastContext();
  const [name, setName] = useState('');
  const [itemType, setItemType] = useState<'goods' | 'service'>('service');
  const [unit, setUnit] = useState('PCS');
  const [hsn, setHsn] = useState('');
  const [rate, setRate] = useState('18');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName('');
    setItemType('service');
    setUnit('PCS');
    setHsn('');
    setRate('18');
  }, [open]);

  if (!open) return null;

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) {
      toast.error('Item name is required');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/expense-items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          item_type: itemType,
          unit,
          hsn_sac: hsn,
          tax_rate: Number(rate),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.item?.id) {
        toast.error(data.error || 'Could not add the item');
        return;
      }
      onCreated(data.item);
      toast.success('Item added');
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <form onSubmit={(event) => void save(event)} className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl" onClick={(event) => event.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Add item</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-full p-1.5 hover:bg-gray-100">
            <X className="h-5 w-5 text-gray-500" />
          </button>
        </div>
        <p className="mb-3 text-xs text-gray-500">This item is only for expenses. It is not added to the items you sell.</p>
        <div className="space-y-3">
          <Input label="Name" value={name} onChange={(event) => setName(event.target.value)} required autoFocus />
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-gray-700">Type</span>
            <select
              value={itemType}
              onChange={(event) => setItemType(event.target.value as 'goods' | 'service')}
              className="min-h-11 w-full rounded-lg border border-gray-300 px-3 py-2 text-base"
            >
              <option value="service">Service</option>
              <option value="goods">Goods</option>
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Unit" value={unit} onChange={(event) => setUnit(event.target.value)} />
            <Input label="HSN / SAC" value={hsn} onChange={(event) => setHsn(event.target.value)} />
          </div>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-gray-700">GST %</span>
            <select
              value={rate}
              onChange={(event) => setRate(event.target.value)}
              className="min-h-11 w-full rounded-lg border border-gray-300 px-3 py-2 text-base"
            >
              {RATE_OPTIONS.map((option) => (
                <option key={option} value={String(option)}>
                  {option}%
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" isLoading={saving}>
            Save item
          </Button>
        </div>
      </form>
    </div>
  );
}
