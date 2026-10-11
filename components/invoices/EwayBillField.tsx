'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';

type Props = {
  invoiceId: string;
  initialNumber?: string | null;
  initialDate?: string | null;
  onSaved?: () => void;
};

export function EwayBillField({ invoiceId, initialNumber, initialDate, onSaved }: Props) {
  const [number, setNumber] = useState(initialNumber || '');
  const [date, setDate] = useState(initialDate ? String(initialDate).slice(0, 10) : '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  const save = async () => {
    setSaving(true);
    setError('');
    setSaved(false);
    try {
      const res = await fetch(`/api/invoices/${invoiceId}/eway`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          eway_bill_number: number.trim(),
          eway_bill_date: date || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Could not save the e-way bill number');
        return;
      }
      setSaved(true);
      onSaved?.();
    } catch {
      setError('Could not save the e-way bill number');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium uppercase tracking-wide text-text-muted">E-way bill</p>
      <p className="text-xs text-text-secondary">
        Paste the 12-digit number from the GST portal. The bill can be saved without it. Print picks it up after you save.
      </p>
      <input
        inputMode="numeric"
        maxLength={12}
        value={number}
        onChange={(e) => {
          setNumber(e.target.value.replace(/\D/g, '').slice(0, 12));
          setSaved(false);
        }}
        placeholder="12-digit e-way bill number"
        className="input w-full text-sm"
      />
      <input
        type="date"
        value={date}
        onChange={(e) => {
          setDate(e.target.value);
          setSaved(false);
        }}
        className="input w-full text-sm"
      />
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
      {saved ? <p className="text-xs text-green-700">Saved. Print the bill to see the number.</p> : null}
      <Button type="button" variant="secondary" className="w-full" onClick={save} disabled={saving}>
        {saving ? 'Saving…' : 'Save e-way bill'}
      </Button>
    </div>
  );
}
