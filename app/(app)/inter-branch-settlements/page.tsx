'use client';

export const dynamic = 'force-dynamic';

import { PageHeader } from '@/components/layout/PageHeader';
import React, { useCallback, useEffect, useState } from 'react';
import { format } from 'date-fns';
import { ArrowRightLeft, Loader2, Undo2 } from 'lucide-react';
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

interface Balance {
  payer_branch_id: string;
  payer_branch_name: string;
  payee_branch_id: string;
  payee_branch_name: string;
  invoiced: number;
  settled: number;
  open: number;
}

interface Settlement {
  id: string;
  mode: 'payment' | 'netting';
  amount: string | number;
  settlement_date: string;
  reference: string | null;
  reversed_at: string | null;
  payer_branch_name: string;
  payee_branch_name: string;
}

const inr = (n: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 }).format(n);

export default function InterBranchSettlementsPage() {
  const { business } = useAuth();
  const toast = useToastContext();
  const [balances, setBalances] = useState<Balance[]>([]);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [accounts, setAccounts] = useState<CashBankAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    pair: '',
    mode: 'payment' as 'payment' | 'netting',
    amount: '',
    settlement_date: format(new Date(), 'yyyy-MM-dd'),
    payer_account_id: '',
    payee_account_id: '',
    reference: '',
  });

  const load = useCallback(async () => {
    if (!business?.id) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/inter-branch-settlements?business_id=${business.id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load');
      setBalances(data.balances || []);
      setSettlements(data.settlements || []);
      setAccounts(data.accounts || []);
    } catch (e: any) {
      toast.error(e.message || 'Failed to load inter-branch balances');
    } finally {
      setLoading(false);
    }
  }, [business?.id, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const pairKey = (b: Balance) => `${b.payer_branch_id}|${b.payee_branch_id}`;
  const selected = balances.find((b) => pairKey(b) === form.pair);
  const reverse = selected
    ? balances.find((b) => b.payer_branch_id === selected.payee_branch_id && b.payee_branch_id === selected.payer_branch_id)
    : undefined;
  const limit = selected ? (form.mode === 'netting' ? Math.min(selected.open, reverse?.open ?? 0) : selected.open) : 0;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!business?.id || !selected) return;
    setSaving(true);
    try {
      const res = await fetch('/api/inter-branch-settlements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: business.id,
          payer_branch_id: selected.payer_branch_id,
          payee_branch_id: selected.payee_branch_id,
          mode: form.mode,
          amount: Number(form.amount),
          settlement_date: form.settlement_date,
          payer_account_id: form.mode === 'payment' ? form.payer_account_id : null,
          payee_account_id: form.mode === 'payment' ? form.payee_account_id : null,
          reference: form.reference || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to settle');
      toast.success('Inter-branch balance settled');
      setForm((f) => ({ ...f, amount: '', reference: '' }));
      await load();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const reverseSettlement = async (id: string) => {
    if (!window.confirm('Reverse this settlement? Its postings are reversed and the balance opens again.')) return;
    try {
      const res = await fetch(`/api/inter-branch-settlements/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to reverse');
      toast.success('Settlement reversed');
      await load();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const accountLabel = (a: CashBankAccount) => `${a.code} · ${a.name} (${a.kind === 'cash' ? 'Cash' : 'Bank'})`;
  const open = balances.filter((b) => b.open > 0.004);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Inter-branch balances"
        subtitle="What branches on different GSTINs owe each other for stock transfers, and how it was settled"
      />

      <Card>
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
          </div>
        ) : open.length === 0 ? (
          <p className="text-center py-12 text-text-secondary">No open inter-branch balances</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="py-3 px-4">Owes</th>
                  <th className="py-3 px-4">To</th>
                  <th className="py-3 px-4 text-right">Invoiced</th>
                  <th className="py-3 px-4 text-right">Settled</th>
                  <th className="py-3 px-4 text-right">Open</th>
                  <th className="py-3 px-4" />
                </tr>
              </thead>
              <tbody>
                {open.map((b) => (
                  <tr key={pairKey(b)} className="border-b border-border">
                    <td className="py-3 px-4">{b.payer_branch_name}</td>
                    <td className="py-3 px-4">{b.payee_branch_name}</td>
                    <td className="py-3 px-4 text-right">{inr(b.invoiced)}</td>
                    <td className="py-3 px-4 text-right">{inr(b.settled)}</td>
                    <td className="py-3 px-4 text-right font-medium">{inr(b.open)}</td>
                    <td className="py-3 px-4 text-right">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setForm((f) => ({ ...f, pair: pairKey(b), amount: String(b.open) }))}
                      >
                        Settle
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {selected && (
        <Card>
          <form onSubmit={submit} className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-3 text-sm text-text-secondary">
              {selected.payer_branch_name} owes {selected.payee_branch_name} {inr(selected.open)}
            </div>
            <div>
              <label className="block text-sm font-medium text-text-primary mb-1">How</label>
              <select
                className="w-full rounded-md border border-border px-3 py-2 text-sm"
                value={form.mode}
                onChange={(e) => setForm({ ...form, mode: e.target.value as 'payment' | 'netting' })}
              >
                <option value="payment">Money paid between the branches</option>
                <option value="netting" disabled={!reverse || reverse.open <= 0}>
                  Net off what they owe each other
                </option>
              </select>
            </div>
            <Input
              type="date"
              label="Date"
              value={form.settlement_date}
              onChange={(e) => setForm({ ...form, settlement_date: e.target.value })}
              required
            />
            <Input
              type="number"
              label={`Amount (up to ${inr(limit)})`}
              min="0.01"
              step="0.01"
              max={limit}
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
              required
            />
            {form.mode === 'payment' && (
              <>
                <div>
                  <label className="block text-sm font-medium text-text-primary mb-1">
                    Paid from ({selected.payer_branch_name})
                  </label>
                  <select
                    className="w-full rounded-md border border-border px-3 py-2 text-sm"
                    value={form.payer_account_id}
                    onChange={(e) => setForm({ ...form, payer_account_id: e.target.value })}
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
                  <label className="block text-sm font-medium text-text-primary mb-1">
                    Received in ({selected.payee_branch_name})
                  </label>
                  <select
                    className="w-full rounded-md border border-border px-3 py-2 text-sm"
                    value={form.payee_account_id}
                    onChange={(e) => setForm({ ...form, payee_account_id: e.target.value })}
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
              </>
            )}
            <Input
              label="Reference (UTR / note)"
              value={form.reference}
              onChange={(e) => setForm({ ...form, reference: e.target.value })}
            />
            <div className="md:col-span-3 flex justify-end">
              <Button type="submit" disabled={saving || limit <= 0}>
                {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <ArrowRightLeft className="w-4 h-4 mr-2" />}
                Settle
              </Button>
            </div>
          </form>
        </Card>
      )}

      {settlements.length > 0 && (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="py-3 px-4">Date</th>
                  <th className="py-3 px-4">From</th>
                  <th className="py-3 px-4">To</th>
                  <th className="py-3 px-4">How</th>
                  <th className="py-3 px-4">Reference</th>
                  <th className="py-3 px-4 text-right">Amount</th>
                  <th className="py-3 px-4" />
                </tr>
              </thead>
              <tbody>
                {settlements.map((s) => (
                  <tr key={s.id} className={`border-b border-border ${s.reversed_at ? 'text-text-secondary line-through' : ''}`}>
                    <td className="py-3 px-4">{format(new Date(s.settlement_date), 'dd MMM yyyy')}</td>
                    <td className="py-3 px-4">{s.payer_branch_name}</td>
                    <td className="py-3 px-4">{s.payee_branch_name}</td>
                    <td className="py-3 px-4">{s.mode === 'netting' ? 'Netted' : 'Paid'}</td>
                    <td className="py-3 px-4">{s.reference || '-'}</td>
                    <td className="py-3 px-4 text-right">{inr(Number(s.amount))}</td>
                    <td className="py-3 px-4 text-right">
                      {!s.reversed_at && (
                        <Button type="button" variant="outline" size="sm" onClick={() => reverseSettlement(s.id)}>
                          <Undo2 className="w-4 h-4" />
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
