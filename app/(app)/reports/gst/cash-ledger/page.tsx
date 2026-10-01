'use client';

export const dynamic = 'force-dynamic';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { useBranch } from '@/contexts/BranchContext';
import { useToastContext } from '@/contexts/ToastContext';

type CashHead = 'IGST' | 'CGST' | 'SGST' | 'CESS';
type LiabilityHead = CashHead | 'RCM' | 'RCM_IGST' | 'RCM_CGST' | 'RCM_SGST';

type HeadRow = {
  cash_account_code: string;
  cash_balance: number;
  output_liability_account: string;
  output_liability: number;
  rcm_liability_account: string | null;
  rcm_liability: number;
};

type LedgerPayload = {
  as_on_date: string;
  igst: HeadRow;
  cgst: HeadRow;
  sgst: HeadRow;
  cess: HeadRow;
  pooled_rcm: { liability_account: string; liability: number; cash_account_when_unspecified: string };
  statement: Array<{
    id: string;
    date: string;
    head: CashHead;
    account_code: string;
    voucher_type: string;
    voucher_id: string;
    debit: number;
    credit: number;
    running_balance: number;
    narration: string | null;
    reference_number: string | null;
  }>;
};

type BankAccount = { id: string; account_code: string; account_name: string };

const HEADS: CashHead[] = ['IGST', 'CGST', 'SGST', 'CESS'];
const LIABILITY_HEADS: LiabilityHead[] = ['IGST', 'CGST', 'SGST', 'CESS', 'RCM', 'RCM_IGST', 'RCM_CGST', 'RCM_SGST'];

function inr(n: number) {
  return `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function cashHeadForLiability(head: LiabilityHead, pooledCash: CashHead): CashHead {
  if (head === 'RCM') return pooledCash;
  if (head === 'RCM_IGST' || head === 'IGST') return 'IGST';
  if (head === 'RCM_CGST' || head === 'CGST') return 'CGST';
  if (head === 'RCM_SGST' || head === 'SGST') return 'SGST';
  return 'CESS';
}

export default function GstCashLedgerPage() {
  const { business, user } = useAuth();
  const { currentBranchId } = useBranch();
  const toast = useToastContext();
  const [asOn, setAsOn] = useState(todayIso());
  const [data, setData] = useState<LedgerPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [banks, setBanks] = useState<BankAccount[]>([]);
  const [deposit, setDeposit] = useState({
    date: todayIso(),
    tax_head: 'IGST' as CashHead,
    amount: '',
    bank_account_id: '',
    challan_number: '',
  });
  const [useForm, setUseForm] = useState({
    date: todayIso(),
    tax_head: 'IGST' as LiabilityHead,
    cash_head: 'IGST' as CashHead,
    amount: '',
  });
  const [busy, setBusy] = useState(false);

  const branchQuery = currentBranchId && currentBranchId !== 'ALL' ? currentBranchId : '';
  const allBranches = !branchQuery;

  const load = useCallback(async () => {
    if (!business?.id) return;
    setLoading(true);
    try {
      const q = new URLSearchParams({
        business_id: business.id,
        as_on_date: asOn,
        ...(branchQuery ? { branch_id: branchQuery } : { consolidated: '1' }),
      });
      const res = await fetch(`/api/gst/cash-ledger?${q}`);
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error || 'Could not load the cash ledger');
        return;
      }
      setData(json);
    } catch {
      toast.error('Could not load the cash ledger');
    } finally {
      setLoading(false);
    }
  }, [business?.id, asOn, branchQuery, toast]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!business?.id) return;
    fetch(`/api/accounts?business_id=${business.id}&account_type=asset&is_active=true&limit=200`)
      .then((r) => r.json())
      .then((json) => {
        const rows = (json.accounts || []) as BankAccount[];
        const bankRows = rows.filter(
          (a) => a.account_code === '1101' || a.account_code === '1102' || /bank/i.test(a.account_name || '')
        );
        setBanks(bankRows);
        const def = bankRows.find((a) => a.account_code === '1102');
        if (def) setDeposit((d) => ({ ...d, bank_account_id: d.bank_account_id || def.id }));
      })
      .catch(() => setBanks([]));
  }, [business?.id]);

  const headMap = useMemo(() => {
    if (!data) return null;
    return { IGST: data.igst, CGST: data.cgst, SGST: data.sgst, CESS: data.cess };
  }, [data]);

  const available = headMap ? headMap[cashHeadForLiability(useForm.tax_head, useForm.cash_head)].cash_balance : 0;
  const useAmount = Number(useForm.amount);
  const useTooHigh = Number.isFinite(useAmount) && useAmount > available + 0.001;

  async function post(url: string, body: Record<string, unknown>) {
    if (!business?.id || !user?.id) return;
    if (allBranches) {
      toast.error('Select a branch before posting');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, business_id: business.id, branch_id: branchQuery }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error || 'Request failed');
        return;
      }
      toast.success('Saved');
      await load();
    } catch {
      toast.error('Request failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">GST electronic cash ledger</h1>
          <p className="text-sm text-gray-500 mt-1">
            Deposit credits the cash ledger and the bank. Utilisation moves that balance onto GST liability.
            Pooled RCM (2155) is paid from IGST cash (1130) unless you choose CGST or SGST.
          </p>
        </div>
        <div className="flex items-end gap-3">
          <label className="text-xs font-medium text-gray-700">
            As on
            <input
              type="date"
              value={asOn}
              onChange={(e) => setAsOn(e.target.value)}
              className="mt-1 block px-3 py-2 border border-gray-300 rounded-lg text-sm"
            />
          </label>
          <Link href="/reports/gst/gstr3b" className="text-sm text-primary-700 hover:underline pb-2">
            GSTR-3B
          </Link>
        </div>
      </div>

      {allBranches && (
        <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2">
          Showing every branch. Select one branch to deposit or utilise.
        </p>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {HEADS.map((head) => {
          const row = headMap?.[head];
          return (
            <div key={head} className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
              <p className="text-sm font-medium text-gray-700">{head} cash</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">{row ? inr(row.cash_balance) : '—'}</p>
              <p className="text-xs text-gray-500 mt-2">
                Account {row?.cash_account_code || '—'}
              </p>
              <p className="text-xs text-gray-700 mt-2">
                Output liability {row?.output_liability_account}: {row ? inr(row.output_liability) : '—'}
              </p>
              {row?.rcm_liability_account && (
                <p className="text-xs text-gray-700">
                  RCM {row.rcm_liability_account}: {inr(row.rcm_liability)}
                </p>
              )}
            </div>
          );
        })}
      </div>

      {data && (
        <p className="text-sm text-gray-700">
          Pooled RCM liability {data.pooled_rcm.liability_account}: {inr(data.pooled_rcm.liability)}. Unspecified
          payments of this account use cash ledger {data.pooled_rcm.cash_account_when_unspecified} (IGST).
        </p>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <form
          className="bg-white border border-gray-200 rounded-xl p-4 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            post('/api/gst/cash-ledger/deposit', {
              payment_date: deposit.date,
              tax_head: deposit.tax_head,
              amount: Number(deposit.amount),
              bank_account_id: deposit.bank_account_id || undefined,
              challan_number: deposit.challan_number || undefined,
            });
          }}
        >
          <h2 className="font-semibold text-gray-900">Deposit</h2>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs text-gray-600">
              Date
              <input type="date" required value={deposit.date} onChange={(e) => setDeposit({ ...deposit, date: e.target.value })} className="mt-1 w-full border border-gray-300 rounded-lg px-2 py-2 text-sm" />
            </label>
            <label className="text-xs text-gray-600">
              GST head
              <select value={deposit.tax_head} onChange={(e) => setDeposit({ ...deposit, tax_head: e.target.value as CashHead })} className="mt-1 w-full border border-gray-300 rounded-lg px-2 py-2 text-sm">
                {HEADS.map((h) => <option key={h}>{h}</option>)}
              </select>
            </label>
            <label className="text-xs text-gray-600">
              Amount
              <input type="number" required min="0.01" step="0.01" value={deposit.amount} onChange={(e) => setDeposit({ ...deposit, amount: e.target.value })} className="mt-1 w-full border border-gray-300 rounded-lg px-2 py-2 text-sm" />
            </label>
            <label className="text-xs text-gray-600">
              Bank account
              <select value={deposit.bank_account_id} onChange={(e) => setDeposit({ ...deposit, bank_account_id: e.target.value })} className="mt-1 w-full border border-gray-300 rounded-lg px-2 py-2 text-sm">
                <option value="">Default bank (1102)</option>
                {banks.map((b) => (
                  <option key={b.id} value={b.id}>{b.account_code} {b.account_name}</option>
                ))}
              </select>
            </label>
            <label className="text-xs text-gray-600 col-span-2">
              Challan number
              <input value={deposit.challan_number} onChange={(e) => setDeposit({ ...deposit, challan_number: e.target.value })} className="mt-1 w-full border border-gray-300 rounded-lg px-2 py-2 text-sm" />
            </label>
          </div>
          <button type="submit" disabled={busy || allBranches} className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm disabled:opacity-50">
            Deposit
          </button>
        </form>

        <form
          className="bg-white border border-gray-200 rounded-xl p-4 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (useTooHigh) {
              toast.error('Amount is greater than the available cash balance');
              return;
            }
            post('/api/gst/cash-ledger/utilize', {
              payment_date: useForm.date,
              tax_head: useForm.tax_head,
              cash_head: useForm.tax_head === 'RCM' ? useForm.cash_head : undefined,
              amount: useAmount,
            });
          }}
        >
          <h2 className="font-semibold text-gray-900">Utilisation</h2>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs text-gray-600">
              Date
              <input type="date" required value={useForm.date} onChange={(e) => setUseForm({ ...useForm, date: e.target.value })} className="mt-1 w-full border border-gray-300 rounded-lg px-2 py-2 text-sm" />
            </label>
            <label className="text-xs text-gray-600">
              Liability head
              <select
                value={useForm.tax_head}
                onChange={(e) => setUseForm({ ...useForm, tax_head: e.target.value as LiabilityHead })}
                className="mt-1 w-full border border-gray-300 rounded-lg px-2 py-2 text-sm"
              >
                {LIABILITY_HEADS.map((h) => <option key={h}>{h}</option>)}
              </select>
            </label>
            {useForm.tax_head === 'RCM' && (
              <label className="text-xs text-gray-600 col-span-2">
                Cash ledger for pooled RCM (2155)
                <select value={useForm.cash_head} onChange={(e) => setUseForm({ ...useForm, cash_head: e.target.value as CashHead })} className="mt-1 w-full border border-gray-300 rounded-lg px-2 py-2 text-sm">
                  <option value="IGST">IGST (1130)</option>
                  <option value="CGST">CGST (1131)</option>
                  <option value="SGST">SGST (1132)</option>
                </select>
              </label>
            )}
            <label className="text-xs text-gray-600 col-span-2">
              Amount — available {inr(available)}
              <input type="number" required min="0.01" step="0.01" value={useForm.amount} onChange={(e) => setUseForm({ ...useForm, amount: e.target.value })} className="mt-1 w-full border border-gray-300 rounded-lg px-2 py-2 text-sm" />
            </label>
          </div>
          {useTooHigh && <p className="text-xs text-red-700">Amount is greater than the available cash balance.</p>}
          <button type="submit" disabled={busy || allBranches || useTooHigh} className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm disabled:opacity-50">
            Utilise
          </button>
        </form>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">Statement</h2>
          {loading && <span className="text-xs text-gray-500">Loading…</span>}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Date</th>
                <th className="px-4 py-2 text-left font-medium">Head</th>
                <th className="px-4 py-2 text-left font-medium">Type</th>
                <th className="px-4 py-2 text-right font-medium">Debit</th>
                <th className="px-4 py-2 text-right font-medium">Credit</th>
                <th className="px-4 py-2 text-right font-medium">Running balance</th>
                <th className="px-4 py-2 text-left font-medium">Reference</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {(data?.statement || []).length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-6 text-gray-500">No cash ledger lines up to this date.</td></tr>
              ) : (
                data!.statement.map((line) => {
                  const reversedVoucherIds = new Set(
                    data!.statement
                      .filter((row) => (row.narration || '').startsWith('Reversal:'))
                      .map((row) => row.voucher_id),
                  );
                  const reversible =
                    (line.voucher_type === 'gst_cash_deposit' || line.voucher_type === 'gst_cash_utilization') &&
                    !(line.narration || '').startsWith('Reversal:') &&
                    !reversedVoucherIds.has(line.voucher_id);
                  return (
                    <tr key={line.id} className="border-t border-gray-100">
                      <td className="px-4 py-2">{line.date}</td>
                      <td className="px-4 py-2">{line.head}</td>
                      <td className="px-4 py-2">{line.voucher_type.replace(/_/g, ' ')}</td>
                      <td className="px-4 py-2 text-right">{line.debit ? inr(line.debit) : ''}</td>
                      <td className="px-4 py-2 text-right">{line.credit ? inr(line.credit) : ''}</td>
                      <td className="px-4 py-2 text-right">{inr(line.running_balance)}</td>
                      <td className="px-4 py-2 text-gray-600">{line.reference_number || line.narration || ''}</td>
                      <td className="px-4 py-2 text-right">
                        {reversible && (
                          <button
                            type="button"
                            className="text-xs text-red-700 hover:underline disabled:opacity-50"
                            disabled={busy || allBranches}
                            onClick={() => {
                              const reason = window.prompt('Reason for reversal');
                              if (!reason) return;
                              post('/api/gst/cash-ledger/reverse', {
                                voucher_id: line.voucher_id,
                                voucher_type: line.voucher_type,
                                reason,
                                entry_date: todayIso(),
                              });
                            }}
                          >
                            Reverse
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
