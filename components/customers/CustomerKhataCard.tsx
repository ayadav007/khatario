'use client';

import { useCallback, useEffect, useState } from 'react';
import { BookOpen, Loader2, Send } from 'lucide-react';
import Link from 'next/link';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useToastContext } from '@/contexts/ToastContext';
import { KHATA_RULE_LABEL, khataReasonLabel, type KhataRule } from '@/lib/khata/rules';
import { khataSettlementDayLabel, khataShortDate } from '@/lib/khata/cycle';

type Summary = {
  customerId: string;
  name: string;
  phone: string | null;
  enabled: boolean;
  requestedAt: string | null;
  settlementDay: number | null;
  creditLimit: number;
  balance: number;
  overdueAmount: number;
  pendingOrders: number;
  available: number | null;
  nextStatementDate: string | null;
  payBy: string | null;
  graceDays: number;
  rules: { overLimitRule: KhataRule; overdueRule: KhataRule };
  customRules: { overLimitRule: KhataRule | null; overdueRule: KhataRule | null };
};

type KhataResponse = {
  summary: Summary;
  bills: { id: string; invoice_number: string; invoice_date: string; due_date: string | null; grand_total: number; balance_amount: number; overdue: boolean }[];
  orders: { id: string; order_number: string; created_at: string; grand_total: number; status: string; khata_approval: string | null; khata_approval_reason: string | null }[];
  store_logins: { id: string; phone: string; name: string | null }[];
  statements: { id: string; statement_date: string; due_date: string; closing_due: number; sent_at: string | null }[];
};

const inr = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const DAYS = [...Array.from({ length: 28 }, (_, i) => i + 1), 0];
const PAY_MODES: { value: string; label: string }[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'upi', label: 'UPI' },
  { value: 'bank_transfer', label: 'Bank transfer' },
  { value: 'card', label: 'Card' },
  { value: 'cheque', label: 'Cheque' },
];

/**
 * Store khata on the customer page (docs/plan/STORE_KHATA.md): open it with a settlement day
 * and limit, see what is due and overdue, record a payment that settles the oldest bills first,
 * and send the statement.
 */
export function CustomerKhataCard({ customerId, onChanged }: { customerId: string; onChanged?: () => void }) {
  const toast = useToastContext();
  const [data, setData] = useState<KhataResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [receiving, setReceiving] = useState(false);
  const [form, setForm] = useState({ day: '5', limit: '', overLimit: '', overdue: '' });
  const [pay, setPay] = useState({ amount: '', mode: 'cash', date: '' });

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/customers/${customerId}/khata`, { credentials: 'include' });
      if (!res.ok) return;
      const body = (await res.json()) as KhataResponse;
      setData(body);
      const s = body.summary;
      setForm({
        day: String(s.settlementDay ?? 5),
        limit: s.creditLimit > 0 ? String(s.creditLimit) : '',
        overLimit: s.customRules.overLimitRule ?? '',
        overdue: s.customRules.overdueRule ?? '',
      });
    } finally {
      setLoading(false);
    }
  }, [customerId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function post(
    payload: Record<string, unknown>,
    success: string | ((body: Record<string, unknown>) => string),
  ): Promise<boolean> {
    setBusy(true);
    try {
      const res = await fetch(`/api/customers/${customerId}/khata`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body.error || 'Could not update the khata');
        return false;
      }
      const message = typeof success === 'function' ? success(body) : success;
      if (body.sent === false) toast.warning(message);
      else toast.success(message);
      await load();
      onChanged?.();
      return true;
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <Card padding="md">
        <div className="flex items-center gap-2 text-sm text-text-secondary">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading khata
        </div>
      </Card>
    );
  }
  if (!data) return null;
  const s = data.summary;
  const pending = data.orders.filter((o) => o.khata_approval === 'pending' && o.status !== 'cancelled');

  const openForm = (
    <div className="mt-3 grid gap-3 sm:grid-cols-2">
      <label className="text-sm">
        <span className="mb-1 block text-text-secondary">Settlement day</span>
        <select
          className="w-full rounded-lg border border-border bg-surface px-3 py-2"
          value={form.day}
          onChange={(e) => setForm({ ...form, day: e.target.value })}
        >
          {DAYS.map((d) => (
            <option key={d} value={String(d)}>
              {khataSettlementDayLabel(d)}
            </option>
          ))}
        </select>
      </label>
      <label className="text-sm">
        <span className="mb-1 block text-text-secondary">Credit limit (blank for no limit)</span>
        <input
          inputMode="decimal"
          className="w-full rounded-lg border border-border bg-surface px-3 py-2"
          value={form.limit}
          placeholder="No limit"
          onChange={(e) => setForm({ ...form, limit: e.target.value.replace(/[^\d.]/g, '') })}
        />
      </label>
      <label className="text-sm">
        <span className="mb-1 block text-text-secondary">When over the limit</span>
        <select
          className="w-full rounded-lg border border-border bg-surface px-3 py-2"
          value={form.overLimit}
          onChange={(e) => setForm({ ...form, overLimit: e.target.value })}
        >
          <option value="">Business rule ({KHATA_RULE_LABEL[s.rules.overLimitRule].toLowerCase()})</option>
          {(Object.keys(KHATA_RULE_LABEL) as KhataRule[]).map((r) => (
            <option key={r} value={r}>
              {KHATA_RULE_LABEL[r]}
            </option>
          ))}
        </select>
      </label>
      <label className="text-sm">
        <span className="mb-1 block text-text-secondary">When bills are overdue</span>
        <select
          className="w-full rounded-lg border border-border bg-surface px-3 py-2"
          value={form.overdue}
          onChange={(e) => setForm({ ...form, overdue: e.target.value })}
        >
          <option value="">Business rule ({KHATA_RULE_LABEL[s.rules.overdueRule].toLowerCase()})</option>
          {(Object.keys(KHATA_RULE_LABEL) as KhataRule[]).map((r) => (
            <option key={r} value={r}>
              {KHATA_RULE_LABEL[r]}
            </option>
          ))}
        </select>
      </label>
      <div className="flex flex-wrap gap-2 sm:col-span-2">
        <Button
          disabled={busy}
          onClick={async () => {
            const ok = await post(
              {
                action: 'open',
                settlement_day: Number(form.day),
                credit_limit: form.limit === '' ? 0 : Number(form.limit),
                over_limit_rule: form.overLimit || null,
                overdue_rule: form.overdue || null,
              },
              s.enabled ? 'Khata updated' : 'Khata opened',
            );
            if (ok) setEditing(false);
          }}
        >
          {s.enabled ? 'Save' : 'Open khata'}
        </Button>
        {s.enabled ? (
          <Button variant="ghost" disabled={busy} onClick={() => setEditing(false)}>
            Cancel
          </Button>
        ) : null}
      </div>
      {!s.phone ? (
        <p className="text-xs text-amber-700 sm:col-span-2">
          Add this customer&apos;s mobile number so they can order on khata from your store and get statements.
        </p>
      ) : null}
    </div>
  );

  return (
    <Card padding="md">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <BookOpen className="h-5 w-5 text-primary" />
          <h3 className="font-semibold text-text-primary">Store khata</h3>
          {s.enabled ? (
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">Open</span>
          ) : s.requestedAt ? (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">Requested</span>
          ) : null}
        </div>
        {s.enabled && !editing ? (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => { setReceiving((v) => !v); setPay({ amount: s.balance > 0 ? String(s.balance) : '', mode: 'cash', date: '' }); }}>
              Receive khata payment
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={busy || !s.phone}
              onClick={() =>
                void post({ action: 'send_statement' }, (body) =>
                  body.sent
                    ? 'Statement sent on WhatsApp'
                    : 'Statement saved, but WhatsApp is not connected, so it was not sent',
                )
              }
            >
              <Send className="mr-1 h-3.5 w-3.5" /> Send statement
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
              Change
            </Button>
          </div>
        ) : null}
      </div>

      {!s.enabled ? (
        <>
          <p className="mt-2 text-sm text-text-secondary">
            {s.requestedAt
              ? `${s.name} asked for a khata from your online store. Choose a settlement day and limit to open it, or dismiss the request.`
              : `Let ${s.name} order from your online store and pay on one day of the month.`}
          </p>
          {openForm}
          {s.requestedAt ? (
            <button
              type="button"
              className="mt-2 text-xs text-text-secondary underline"
              disabled={busy}
              onClick={() => void post({ action: 'dismiss_request' }, 'Request dismissed')}
            >
              Dismiss request
            </button>
          ) : null}
        </>
      ) : editing ? (
        <>
          {openForm}
          <button
            type="button"
            className="mt-3 text-xs text-red-600 underline"
            disabled={busy}
            onClick={() => {
              if (window.confirm('Close this khata? New store orders cannot go on khata. What is owed stays on the ledger.')) {
                void post({ action: 'close' }, 'Khata closed').then(() => setEditing(false));
              }
            }}
          >
            Close khata
          </button>
        </>
      ) : (
        <>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <p className="text-xs text-text-secondary">Due</p>
              <p className="text-lg font-semibold">{inr(Math.max(0, s.balance))}</p>
            </div>
            <div>
              <p className="text-xs text-text-secondary">Overdue</p>
              <p className={s.overdueAmount > 0 ? 'text-lg font-semibold text-red-600' : 'text-lg font-semibold'}>
                {inr(s.overdueAmount)}
              </p>
            </div>
            <div>
              <p className="text-xs text-text-secondary">Limit</p>
              <p className="text-lg font-semibold">
                {s.creditLimit > 0 ? inr(s.creditLimit) : 'No limit'}
              </p>
              {s.available != null ? <p className="text-xs text-text-secondary">{inr(s.available)} left</p> : null}
            </div>
            <div>
              <p className="text-xs text-text-secondary">Settles</p>
              <p className="text-sm font-medium">
                {s.settlementDay != null ? khataSettlementDayLabel(s.settlementDay) : ''}
              </p>
              {s.nextStatementDate ? (
                <p className="text-xs text-text-secondary">Next statement {khataShortDate(s.nextStatementDate)}</p>
              ) : null}
            </div>
          </div>
          <p className="mt-2 text-xs text-text-secondary">
            Over limit: {KHATA_RULE_LABEL[s.rules.overLimitRule].toLowerCase()} · Overdue bills:{' '}
            {KHATA_RULE_LABEL[s.rules.overdueRule].toLowerCase()}
            {data.store_logins.length > 0
              ? ` · Store login ${data.store_logins.map((l) => l.phone).join(', ')}`
              : s.phone
                ? ' · Links to their store login when they sign in with this number'
                : ''}
          </p>

          {receiving ? (
            <div className="mt-3 grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-3">
              <label className="text-sm">
                <span className="mb-1 block text-text-secondary">Amount</span>
                <input
                  inputMode="decimal"
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2"
                  value={pay.amount}
                  onChange={(e) => setPay({ ...pay, amount: e.target.value.replace(/[^\d.]/g, '') })}
                />
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-text-secondary">Paid by</span>
                <select
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2"
                  value={pay.mode}
                  onChange={(e) => setPay({ ...pay, mode: e.target.value })}
                >
                  {PAY_MODES.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-text-secondary">Date</span>
                <input
                  type="date"
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2"
                  value={pay.date}
                  onChange={(e) => setPay({ ...pay, date: e.target.value })}
                />
              </label>
              <div className="flex flex-wrap items-end gap-2 sm:col-span-4">
                <Button
                  disabled={busy || !(Number(pay.amount) > 0)}
                  onClick={async () => {
                    const ok = await post(
                      { action: 'receive', amount: Number(pay.amount), payment_mode: pay.mode, payment_date: pay.date || undefined },
                      'Payment recorded against the oldest bills',
                    );
                    if (ok) setReceiving(false);
                  }}
                >
                  Save
                </Button>
                <Button variant="ghost" onClick={() => setReceiving(false)}>
                  Cancel
                </Button>
              </div>
              <p className="text-xs text-text-secondary sm:col-span-3">
                The payment settles the oldest bills first. Paid more than the bills? Record the extra as an advance.
              </p>
            </div>
          ) : null}

          {pending.length > 0 ? (
            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              {pending.length} khata order{pending.length > 1 ? 's' : ''} waiting for your approval (
              {pending.map((o) => `${o.order_number}: ${khataReasonLabel(o.khata_approval_reason).toLowerCase()}`).join(', ')}
              ).{' '}
              <Link className="font-medium underline" href="/settings/online-store/orders?khata=pending">
                Approve or reject
              </Link>
            </div>
          ) : null}

          {data.bills.length > 0 ? (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-text-secondary">
                    <th className="py-1 pr-3 font-medium">Bill</th>
                    <th className="py-1 pr-3 font-medium">Date</th>
                    <th className="py-1 pr-3 font-medium">Due</th>
                    <th className="py-1 text-right font-medium">Open</th>
                  </tr>
                </thead>
                <tbody>
                  {data.bills.slice(0, 10).map((b) => (
                    <tr key={b.id} className="border-t border-border">
                      <td className="py-1.5 pr-3">
                        <Link className="text-primary hover:underline" href={`/invoices/${b.id}`}>
                          {b.invoice_number}
                        </Link>
                      </td>
                      <td className="py-1.5 pr-3">{khataShortDate(b.invoice_date)}</td>
                      <td className={b.overdue ? 'py-1.5 pr-3 text-red-600' : 'py-1.5 pr-3'}>
                        {b.due_date ? khataShortDate(b.due_date) : '-'}
                        {b.overdue ? ' · overdue' : ''}
                      </td>
                      <td className="py-1.5 text-right">{inr(b.balance_amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {data.bills.length > 10 ? (
                <p className="mt-1 text-xs text-text-secondary">And {data.bills.length - 10} more open bills.</p>
              ) : null}
            </div>
          ) : (
            <p className="mt-3 text-sm text-text-secondary">No open bills.</p>
          )}

          {data.statements.length > 0 ? (
            <p className="mt-3 text-xs text-text-secondary">
              Last statement {khataShortDate(data.statements[0].statement_date)}: {inr(data.statements[0].closing_due)}, pay by{' '}
              {khataShortDate(data.statements[0].due_date)}
              {data.statements[0].sent_at ? ', sent on WhatsApp' : ', not sent on WhatsApp'}.
            </p>
          ) : null}
        </>
      )}
    </Card>
  );
}
