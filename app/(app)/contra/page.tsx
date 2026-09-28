'use client';

export const dynamic = 'force-dynamic';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { ArrowRightLeft, Loader2 } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useAuth } from '@/contexts/AuthContext';
import { useToastContext } from '@/contexts/ToastContext';

interface CashBankAccount {
  id: string;
  code: string;
  name: string;
  kind: 'cash' | 'bank';
}

interface ContraVoucher {
  voucher_id: string;
  voucher_number: string | null;
  entry_date: string;
  reference_number: string | null;
  narration: string | null;
  from_account: string;
  to_account: string;
  amount: string | number;
}

const inr = (n: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 }).format(n);

export default function ContraPage() {
  const { business } = useAuth();
  const toast = useToastContext();
  const [accounts, setAccounts] = useState<CashBankAccount[]>([]);
  const [vouchers, setVouchers] = useState<ContraVoucher[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    entry_date: format(new Date(), 'yyyy-MM-dd'),
    from_account_id: '',
    to_account_id: '',
    amount: '',
    reference_number: '',
    narration: '',
  });

  const load = useCallback(async () => {
    if (!business?.id) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/contra?business_id=${business.id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load');
      setAccounts(data.accounts || []);
      setVouchers(data.vouchers || []);
    } catch (e: any) {
      toast.error(e.message || 'Failed to load contra entries');
    } finally {
      setLoading(false);
    }
  }, [business?.id, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const from = accounts.find((a) => a.id === form.from_account_id);
  const to = accounts.find((a) => a.id === form.to_account_id);
  const kindLabel = useMemo(() => {
    if (!from || !to) return '';
    if (from.kind === 'cash' && to.kind === 'cash') return 'Cash-to-cash is not a contra entry';
    if (from.kind === 'cash') return 'Cash deposit into bank';
    if (to.kind === 'cash') return 'Cash withdrawal from bank';
    return 'Bank-to-bank transfer';
  }, [from, to]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!business?.id) return;
    setSaving(true);
    try {
      const res = await fetch('/api/contra', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, business_id: business.id, amount: Number(form.amount) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to post contra entry');
      toast.success(`Contra ${data.voucher_number} posted`);
      setForm((f) => ({ ...f, amount: '', reference_number: '', narration: '' }));
      await load();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const accountLabel = (a: CashBankAccount) => `${a.code} · ${a.name} (${a.kind === 'cash' ? 'Cash' : 'Bank'})`;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Contra Entries</h1>
        <p className="text-sm text-text-secondary mt-1">
          Cash deposits, cash withdrawals and transfers between your own bank accounts
        </p>
      </div>

      <Card>
        <form onSubmit={submit} className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Input
            type="date"
            label="Date"
            value={form.entry_date}
            onChange={(e) => setForm({ ...form, entry_date: e.target.value })}
            required
          />
          <div>
            <label className="block text-sm font-medium text-text-primary mb-1">From (money leaves)</label>
            <select
              className="w-full rounded-md border border-border px-3 py-2 text-sm"
              value={form.from_account_id}
              onChange={(e) => setForm({ ...form, from_account_id: e.target.value })}
              required
            >
              <option value="">Select account</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {accountLabel(a)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-text-primary mb-1">To (money arrives)</label>
            <select
              className="w-full rounded-md border border-border px-3 py-2 text-sm"
              value={form.to_account_id}
              onChange={(e) => setForm({ ...form, to_account_id: e.target.value })}
              required
            >
              <option value="">Select account</option>
              {accounts
                .filter((a) => a.id !== form.from_account_id)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {accountLabel(a)}
                  </option>
                ))}
            </select>
          </div>
          <Input
            type="number"
            label="Amount"
            min="0.01"
            step="0.01"
            value={form.amount}
            onChange={(e) => setForm({ ...form, amount: e.target.value })}
            required
          />
          <Input
            label="Reference (cheque / UTR)"
            value={form.reference_number}
            onChange={(e) => setForm({ ...form, reference_number: e.target.value })}
          />
          <Input
            label="Narration"
            value={form.narration}
            onChange={(e) => setForm({ ...form, narration: e.target.value })}
          />
          <div className="md:col-span-3 flex items-center justify-between">
            <span className="text-sm text-text-secondary">{kindLabel}</span>
            <Button type="submit" disabled={saving || (from?.kind === 'cash' && to?.kind === 'cash')}>
              {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <ArrowRightLeft className="w-4 h-4 mr-2" />}
              Post contra
            </Button>
          </div>
        </form>
      </Card>

      <Card>
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
          </div>
        ) : vouchers.length === 0 ? (
          <p className="text-center py-12 text-text-secondary">No contra entries yet</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="py-3 px-4">Date</th>
                  <th className="py-3 px-4">Voucher</th>
                  <th className="py-3 px-4">From</th>
                  <th className="py-3 px-4">To</th>
                  <th className="py-3 px-4">Reference</th>
                  <th className="py-3 px-4 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {vouchers.map((v) => (
                  <tr key={v.voucher_id} className="border-b border-border">
                    <td className="py-3 px-4">{format(new Date(v.entry_date), 'dd MMM yyyy')}</td>
                    <td className="py-3 px-4 font-mono">{v.voucher_number || '-'}</td>
                    <td className="py-3 px-4">{v.from_account}</td>
                    <td className="py-3 px-4">{v.to_account}</td>
                    <td className="py-3 px-4 text-text-secondary">{v.reference_number || '-'}</td>
                    <td className="py-3 px-4 text-right">{inr(Number(v.amount))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
