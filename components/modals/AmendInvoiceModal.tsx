'use client';

import { useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';

interface AmendInvoiceModalProps {
  invoiceId: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  billingAddress: string;
  billingName: string;
  onSuccess: () => void;
  onClose: () => void;
}

function inputDate(value: string | null | undefined): string {
  if (!value) return '';
  return String(value).slice(0, 10);
}

export function AmendInvoiceModal({
  invoiceId,
  invoiceNumber,
  invoiceDate,
  dueDate,
  billingAddress,
  billingName,
  onSuccess,
  onClose,
}: AmendInvoiceModalProps) {
  const [date, setDate] = useState(inputDate(invoiceDate));
  const [due, setDue] = useState(inputDate(dueDate));
  const [address, setAddress] = useState(billingAddress || '');
  const [name, setName] = useState(billingName || '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const response = await fetch(`/api/invoices/${invoiceId}/amend`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invoice_date: date,
          due_date: due || null,
          billing_address: address,
          billing_name: name,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || 'Failed to amend the invoice');
      }
      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to amend the invoice');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-4">
      <form onSubmit={handleSubmit} className="w-full max-w-lg rounded-xl bg-white dark:bg-zinc-900 shadow-xl">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div>
            <h2 className="text-base font-semibold">Amend {invoiceNumber}</h2>
            <p className="text-xs text-text-muted">Date, due date, address, and the name on this bill.</p>
          </div>
          <button type="button" onClick={onClose} className="p-1 text-text-muted" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="space-y-3 px-4 py-4">
          {error && <p className="text-sm text-red-600">{error}</p>}
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Invoice date</span>
            <input
              type="date"
              required
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full rounded-md border px-3 py-2"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Due date</span>
            <input
              type="date"
              value={due}
              onChange={(e) => setDue(e.target.value)}
              className="w-full rounded-md border px-3 py-2"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Name on this bill</span>
            <input
              type="text"
              maxLength={255}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-md border px-3 py-2"
            />
            <span className="mt-1 block text-xs text-text-muted">Printed on this invoice only. The customer record is not renamed.</span>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Billing address</span>
            <textarea
              rows={3}
              maxLength={2000}
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="w-full rounded-md border px-3 py-2"
            />
          </label>
        </div>
        <div className="flex justify-end gap-2 border-t px-4 py-3">
          <Button type="button" variant="secondary" onClick={onClose} disabled={loading}>
            Close
          </Button>
          <Button type="submit" variant="primary" disabled={loading}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            <span className={loading ? 'ml-2' : ''}>Save amendment</span>
          </Button>
        </div>
      </form>
    </div>
  );
}
