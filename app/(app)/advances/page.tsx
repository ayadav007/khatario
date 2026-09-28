'use client';

export const dynamic = 'force-dynamic';

import React, { useCallback, useEffect, useState } from 'react';
import { format } from 'date-fns';
import { Loader2, X } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useAuth } from '@/contexts/AuthContext';
import { useToastContext } from '@/contexts/ToastContext';
import { GST_RATE_SLABS } from '@/lib/gst/rates';

type AdvanceType = 'received' | 'paid';

interface Advance {
  id: string;
  type: AdvanceType;
  voucher_number: string | null;
  payment_date: string;
  party_name: string;
  amount: string;
  taxable_value: string | null;
  cgst: string;
  sgst: string;
  igst: string;
  supply_type: 'goods' | 'services';
  tax_rate: string | null;
  status: string;
  remaining: string;
}

interface Party {
  id: string;
  name: string;
}

interface CashBank {
  id: string;
  code: string;
  name: string;
  kind: 'cash' | 'bank';
}

interface OpenDoc {
  id: string;
  number: string;
  date: string;
  balance_amount: string;
}

const inr = (n: number | string) =>
  Number(n || 0).toLocaleString('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 });
const today = () => format(new Date(), 'yyyy-MM-dd');

export default function AdvancesPage() {
  const { business } = useAuth();
  const toast = useToastContext();
  const [tab, setTab] = useState<AdvanceType>('received');
  const [advances, setAdvances] = useState<Advance[]>([]);
  const [accounts, setAccounts] = useState<CashBank[]>([]);
  const [parties, setParties] = useState<Party[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    party_id: '',
    amount: '',
    payment_date: today(),
    supply_type: 'services' as 'goods' | 'services',
    tax_rate: '18',
    payment_account_id: '',
    reference_number: '',
    notes: '',
  });
  const [action, setAction] = useState<{ advance: Advance; mode: 'adjust' | 'refund' } | null>(null);

  const bizQ = business?.id ? `business_id=${encodeURIComponent(business.id)}` : '';

  const load = useCallback(async () => {
    if (!business?.id) return;
    setLoading(true);
    try {
      const [aRes, pRes] = await Promise.all([
        fetch(`/api/advances?${bizQ}&type=${tab}`),
        fetch(tab === 'received' ? `/api/customers?${bizQ}&limit=1000` : `/api/suppliers?${bizQ}&limit=1000`),
      ]);
      const a = await aRes.json();
      const p = await pRes.json();
      if (!aRes.ok) throw new Error(a.error || 'Failed to load advances');
      setAdvances(a.advances || []);
      setAccounts(a.accounts || []);
      setParties((tab === 'received' ? p.customers : p.suppliers) || []);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  }, [business?.id, bizQ, tab, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!business?.id) return;
    setSaving(true);
    try {
      const res = await fetch('/api/advances', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: business.id,
          type: tab,
          [tab === 'received' ? 'customer_id' : 'supplier_id']: form.party_id,
          amount: Number(form.amount),
          payment_date: form.payment_date,
          supply_type: form.supply_type,
          tax_rate: Number(form.tax_rate),
          payment_account_id: form.payment_account_id,
          reference_number: form.reference_number || null,
          notes: form.notes || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to record advance');
      toast.success(`${tab === 'received' ? 'Receipt voucher' : 'Advance'} ${data.voucher_number} recorded`);
      setForm((f) => ({ ...f, amount: '', reference_number: '', notes: '' }));
      await load();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const showsGst = tab === 'received' && form.supply_type === 'services';

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Advances</h1>
        <p className="text-sm text-text-secondary mt-1">
          Customer advances (receipt vouchers, GST on service advances) and advances paid to suppliers
        </p>
      </div>

      <div className="flex gap-2">
        {(['received', 'paid'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => {
              setTab(t);
              setForm((f) => ({ ...f, party_id: '' }));
            }}
            className={`rounded-md px-4 py-2 text-sm font-medium ${
              tab === t ? 'bg-primary-600 text-white' : 'border border-border bg-white text-text-primary'
            }`}
          >
            {t === 'received' ? 'From customers' : 'To suppliers'}
          </button>
        ))}
      </div>

      <Card>
        <form onSubmit={submit} className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <label className="block text-sm font-medium text-text-primary mb-1">
              {tab === 'received' ? 'Customer' : 'Supplier'}
            </label>
            <select
              className="w-full rounded-md border border-border px-3 py-2 text-sm"
              value={form.party_id}
              onChange={(e) => setForm({ ...form, party_id: e.target.value })}
              required
            >
              <option value="">Select</option>
              {parties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <Input
            type="date"
            label="Date"
            value={form.payment_date}
            onChange={(e) => setForm({ ...form, payment_date: e.target.value })}
            required
          />
          <Input
            type="number"
            label="Amount (incl. GST)"
            min="0.01"
            step="0.01"
            value={form.amount}
            onChange={(e) => setForm({ ...form, amount: e.target.value })}
            required
          />
          <div>
            <label className="block text-sm font-medium text-text-primary mb-1">
              {tab === 'received' ? 'Received into' : 'Paid from'}
            </label>
            <select
              className="w-full rounded-md border border-border px-3 py-2 text-sm"
              value={form.payment_account_id}
              onChange={(e) => setForm({ ...form, payment_account_id: e.target.value })}
              required
            >
              <option value="">Select</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} · {a.name}
                </option>
              ))}
            </select>
          </div>
          {tab === 'received' && (
            <div>
              <label className="block text-sm font-medium text-text-primary mb-1">Against supply of</label>
              <select
                className="w-full rounded-md border border-border px-3 py-2 text-sm"
                value={form.supply_type}
                onChange={(e) => setForm({ ...form, supply_type: e.target.value as 'goods' | 'services' })}
              >
                <option value="services">Services (GST payable on advance)</option>
                <option value="goods">Goods (no GST on advance)</option>
              </select>
            </div>
          )}
          {showsGst && (
            <div>
              <label className="block text-sm font-medium text-text-primary mb-1">GST rate %</label>
              <select
                className="w-full rounded-md border border-border px-3 py-2 text-sm"
                value={form.tax_rate}
                onChange={(e) => setForm({ ...form, tax_rate: e.target.value })}
              >
                {GST_RATE_SLABS.filter((r) => r > 0).map((r) => (
                  <option key={r} value={r}>
                    {r}%
                  </option>
                ))}
              </select>
            </div>
          )}
          <Input
            label="Reference (UTR / cheque)"
            value={form.reference_number}
            onChange={(e) => setForm({ ...form, reference_number: e.target.value })}
          />
          <Input label="Notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          <div className="md:col-span-4 flex justify-end">
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {tab === 'received' ? 'Issue receipt voucher' : 'Record advance paid'}
            </Button>
          </div>
        </form>
      </Card>

      <Card>
        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
          </div>
        ) : advances.length === 0 ? (
          <p className="text-center py-12 text-text-secondary">No advances yet</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="py-3 px-3">Date</th>
                  <th className="py-3 px-3">Voucher</th>
                  <th className="py-3 px-3">Party</th>
                  <th className="py-3 px-3 text-right">Amount</th>
                  <th className="py-3 px-3 text-right">GST</th>
                  <th className="py-3 px-3 text-right">Unadjusted</th>
                  <th className="py-3 px-3">Status</th>
                  <th className="py-3 px-3" />
                </tr>
              </thead>
              <tbody>
                {advances.map((a) => {
                  const gst = Number(a.cgst) + Number(a.sgst) + Number(a.igst);
                  const open = Number(a.remaining) > 0.005;
                  return (
                    <tr key={a.id} className="border-b border-border">
                      <td className="py-3 px-3">{format(new Date(a.payment_date), 'dd MMM yyyy')}</td>
                      <td className="py-3 px-3 font-mono">{a.voucher_number || '-'}</td>
                      <td className="py-3 px-3">{a.party_name}</td>
                      <td className="py-3 px-3 text-right">{inr(a.amount)}</td>
                      <td className="py-3 px-3 text-right">{gst > 0 ? inr(gst) : '-'}</td>
                      <td className="py-3 px-3 text-right">{inr(a.remaining)}</td>
                      <td className="py-3 px-3 capitalize">{a.status.replace('_', ' ')}</td>
                      <td className="py-3 px-3 whitespace-nowrap text-right">
                        {open && (
                          <>
                            <button
                              type="button"
                              className="text-primary-600 hover:underline mr-3"
                              onClick={() => setAction({ advance: a, mode: 'adjust' })}
                            >
                              Adjust
                            </button>
                            <button
                              type="button"
                              className="text-red-600 hover:underline"
                              onClick={() => setAction({ advance: a, mode: 'refund' })}
                            >
                              Refund
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {action && business?.id && (
        <AdvanceActionModal
          businessId={business.id}
          advance={action.advance}
          mode={action.mode}
          accounts={accounts}
          onClose={() => setAction(null)}
          onDone={async () => {
            setAction(null);
            await load();
          }}
        />
      )}
    </div>
  );
}

function AdvanceActionModal({
  businessId,
  advance,
  mode,
  accounts,
  onClose,
  onDone,
}: {
  businessId: string;
  advance: Advance;
  mode: 'adjust' | 'refund';
  accounts: CashBank[];
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToastContext();
  const [docs, setDocs] = useState<OpenDoc[]>([]);
  const [docId, setDocId] = useState('');
  const [amount, setAmount] = useState(String(Number(advance.remaining)));
  const [date, setDate] = useState(today());
  const [accountId, setAccountId] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (mode !== 'adjust') return;
    fetch(`/api/advances/${advance.id}?business_id=${encodeURIComponent(businessId)}`)
      .then((r) => r.json())
      .then((j) => setDocs(j.open_documents || []))
      .catch(() => setDocs([]));
  }, [advance.id, businessId, mode]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const url = `/api/advances/${advance.id}/${mode}`;
      const body =
        mode === 'adjust'
          ? {
              business_id: businessId,
              [advance.type === 'received' ? 'invoice_id' : 'purchase_id']: docId,
              amount: Number(amount),
              adjustment_date: date,
            }
          : { business_id: businessId, amount: Number(amount), refund_date: date, payment_account_id: accountId };
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      toast.success(`${mode === 'adjust' ? 'Adjusted' : 'Refund voucher'} ${data.voucher_number}`);
      onDone();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const selectedDoc = docs.find((d) => d.id === docId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <form onSubmit={submit} className="w-full max-w-md space-y-4 rounded-xl bg-white p-6 shadow-xl">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            {mode === 'adjust' ? 'Adjust advance' : 'Refund advance'} {advance.voucher_number}
          </h2>
          <button type="button" onClick={onClose} aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>
        <p className="text-sm text-text-secondary">Unadjusted: {inr(advance.remaining)}</p>
        {mode === 'adjust' ? (
          <div>
            <label className="block text-sm font-medium mb-1">
              {advance.type === 'received' ? 'Invoice' : 'Purchase bill'}
            </label>
            <select
              className="w-full rounded-md border border-border px-3 py-2 text-sm"
              value={docId}
              onChange={(e) => {
                setDocId(e.target.value);
                const d = docs.find((x) => x.id === e.target.value);
                if (d) setAmount(String(Math.min(Number(advance.remaining), Number(d.balance_amount))));
              }}
              required
            >
              <option value="">Select</option>
              {docs.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.number} · {d.date} · due {inr(d.balance_amount)}
                </option>
              ))}
            </select>
            {!docs.length && <p className="mt-1 text-xs text-text-secondary">No open documents for this party.</p>}
            {selectedDoc && <p className="mt-1 text-xs text-text-secondary">Balance due {inr(selectedDoc.balance_amount)}</p>}
          </div>
        ) : (
          <div>
            <label className="block text-sm font-medium mb-1">Refund paid from / received into</label>
            <select
              className="w-full rounded-md border border-border px-3 py-2 text-sm"
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              required
            >
              <option value="">Select</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} · {a.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <Input type="number" label="Amount" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required />
        <Input type="date" label="Date" value={date} onChange={(e) => setDate(e.target.value)} required />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {mode === 'adjust' ? 'Adjust' : 'Issue refund voucher'}
          </Button>
        </div>
      </form>
    </div>
  );
}
