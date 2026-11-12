'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { useAuth } from '@/contexts/AuthContext';
import type { RecoveryReport, RecoverySource } from '@/lib/payment-reminders/recovery';

const SOURCE_LABEL: Record<RecoverySource, string> = {
  manual: 'Sent by hand',
  auto_payment_due: 'Auto, before due date',
  auto_overdue: 'Auto, overdue',
};

const RANGES = [
  { id: '30', label: 'Last 30 days', days: 30 },
  { id: '90', label: 'Last 90 days', days: 90 },
  { id: '365', label: 'Last 12 months', days: 365 },
] as const;

function ymd(d: Date): string {
  return new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10);
}

function inr(n: number): string {
  return `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

function pct(part: number, whole: number): string {
  return whole > 0 ? `${Math.round((part / whole) * 100)}%` : '–';
}

function monthLabel(m: string): string {
  const [y, mo] = m.split('-').map(Number);
  return new Date(y, mo - 1, 1).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
}

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-lg border border-border bg-white p-4 dark:border-border-dark dark:bg-slate-900">
      <p className="text-sm text-text-secondary">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-text-primary">{value}</p>
      {note ? <p className="mt-1 text-xs text-text-muted">{note}</p> : null}
    </div>
  );
}

export function ReminderRecoveryTab() {
  const { business } = useAuth();
  const [from, setFrom] = useState(() => ymd(new Date(Date.now() - 89 * 86_400_000)));
  const [to, setTo] = useState(() => ymd(new Date()));
  const [report, setReport] = useState<RecoveryReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!business?.id) return;
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ business_id: business.id, from, to });
      const res = await fetch(`/api/whatsapp/reminders/recovery?${qs}`);
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setError((json && typeof json.error === 'string' && json.error) || 'Could not load recovery');
        setReport(null);
        return;
      }
      setReport(json as RecoveryReport);
    } catch {
      setError('Could not load recovery');
    } finally {
      setLoading(false);
    }
  }, [business?.id, from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  const setRange = (days: number) => {
    setFrom(ymd(new Date(Date.now() - (days - 1) * 86_400_000)));
    setTo(ymd(new Date()));
  };

  const t = report?.totals;
  const maxMonth = Math.max(1, ...(report?.by_month ?? []).map((m) => m.chased));

  return (
    <div className="space-y-4">
      <Card padding="lg">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-wrap gap-2">
            {RANGES.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => setRange(r.days)}
                className="rounded-full border border-border px-3 py-1.5 text-sm text-text-secondary hover:bg-gray-50 dark:border-border-dark dark:hover:bg-slate-800"
              >
                {r.label}
              </button>
            ))}
          </div>
          <div className="flex gap-3">
            <Input label="From" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
            <Input label="To" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>
        <p className="mt-3 text-xs text-text-muted">
          Counts invoices whose first WhatsApp reminder went out in this period. Recovered is money received against
          those invoices after the first reminder.
        </p>
      </Card>

      {loading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin text-text-muted" aria-label="Loading" />
        </div>
      ) : error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
      ) : !t || t.invoices_reminded === 0 ? (
        <Card padding="lg">
          <p className="text-sm text-text-secondary">
            No reminders went out in this period. Turn on auto reminders, or send some from the Send reminders tab.
          </p>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Tile label="Amount reminded" value={inr(t.chased)} note={`${t.invoices_reminded} invoices`} />
            <Tile
              label="Recovered after a reminder"
              value={inr(t.recovered)}
              note={`${pct(t.recovered, t.chased)} of the amount reminded`}
            />
            <Tile
              label="Paid from the reminder link"
              value={inr(t.recovered_via_link)}
              note={`${pct(t.recovered_via_link, t.recovered)} of recovered, paid online`}
            />
            <Tile label="Still pending" value={inr(t.pending)} note="On these invoices today" />
          </div>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Tile label="Reminders sent" value={t.reminders_sent.toLocaleString('en-IN')} />
            <Tile label="Invoices fully paid" value={t.invoices_fully_paid.toLocaleString('en-IN')} />
            <Tile
              label="Average time to pay"
              value={t.avg_days_to_pay == null ? '–' : `${t.avg_days_to_pay} days`}
              note="From first reminder to fully paid"
            />
            <Tile label="Recovery rate" value={pct(t.recovered, t.chased)} />
          </div>

          {report.by_month.length > 0 ? (
            <Card padding="lg">
              <h3 className="text-base font-semibold text-text-primary">Reminded and recovered, by month</h3>
              <div className="mt-2 flex gap-4 text-xs text-text-secondary">
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-sm bg-slate-200 dark:bg-slate-700" aria-hidden /> Amount reminded
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-sm bg-primary-600" aria-hidden /> Recovered
                </span>
              </div>
              <ul className="mt-3 space-y-2.5">
                {report.by_month.map((m) => (
                  <li
                    key={m.month}
                    className="grid grid-cols-[4rem_1fr] items-center gap-3 sm:grid-cols-[4rem_1fr_11rem]"
                    title={`${monthLabel(m.month)}: reminded ${inr(m.chased)}, recovered ${inr(m.recovered)}`}
                  >
                    <span className="text-sm text-text-secondary">{monthLabel(m.month)}</span>
                    <div className="h-3 rounded bg-slate-200 dark:bg-slate-700" style={{ width: `${(m.chased / maxMonth) * 100}%` }}>
                      <div
                        className="h-3 rounded bg-primary-600"
                        style={{ width: `${m.chased > 0 ? Math.min(100, (m.recovered / m.chased) * 100) : 0}%` }}
                      />
                    </div>
                    <span className="col-span-2 text-right text-xs tabular-nums text-text-secondary sm:col-span-1">
                      {inr(m.recovered)} of {inr(m.chased)}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          <Card padding="lg">
            <h3 className="text-base font-semibold text-text-primary">By how the first reminder was sent</h3>
            <div className="mt-3 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-text-secondary">
                    <th className="py-2 pr-4 font-medium">Reminder</th>
                    <th className="py-2 pr-4 text-right font-medium">Invoices</th>
                    <th className="py-2 pr-4 text-right font-medium">Reminded</th>
                    <th className="py-2 pr-4 text-right font-medium">Recovered</th>
                    <th className="py-2 text-right font-medium">Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {report.by_source.map((s) => (
                    <tr key={s.source} className="border-t border-border dark:border-border-dark">
                      <td className="py-2 pr-4 text-text-primary">{SOURCE_LABEL[s.source] ?? s.source}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">{s.invoices}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">{inr(s.chased)}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">{inr(s.recovered)}</td>
                      <td className="py-2 text-right tabular-nums">{pct(s.recovered, s.chased)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card padding="lg">
            <h3 className="text-base font-semibold text-text-primary">Invoices reminded</h3>
            <div className="mt-3 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-text-secondary">
                    <th className="py-2 pr-4 font-medium">Invoice</th>
                    <th className="py-2 pr-4 font-medium">Customer</th>
                    <th className="py-2 pr-4 font-medium">First reminder</th>
                    <th className="py-2 pr-4 text-right font-medium">Reminders</th>
                    <th className="py-2 pr-4 text-right font-medium">Reminded</th>
                    <th className="py-2 pr-4 text-right font-medium">Recovered</th>
                    <th className="py-2 pr-4 text-right font-medium">Pending</th>
                    <th className="py-2 text-right font-medium">Days to pay</th>
                  </tr>
                </thead>
                <tbody>
                  {report.invoices.map((r) => (
                    <tr key={r.invoice_id} className="border-t border-border dark:border-border-dark">
                      <td className="py-2 pr-4">
                        <Link href={`/invoices/${r.invoice_id}`} className="link-primary font-medium">
                          {r.invoice_number}
                        </Link>
                      </td>
                      <td className="py-2 pr-4 text-text-primary">{r.customer_name || '–'}</td>
                      <td className="py-2 pr-4 text-text-secondary">
                        {new Date(r.first_reminder_at).toLocaleDateString('en-IN')}
                      </td>
                      <td className="py-2 pr-4 text-right tabular-nums">{r.reminders}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">{inr(r.chased)}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">
                        {inr(r.recovered)}
                        {r.via_link > 0 ? <span className="ml-1 text-xs text-text-muted">(online)</span> : null}
                      </td>
                      <td className="py-2 pr-4 text-right tabular-nums">{inr(r.pending)}</td>
                      <td className="py-2 text-right tabular-nums">{r.days_to_pay == null ? '–' : r.days_to_pay}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {report.invoices.length >= 100 ? (
              <p className="mt-2 text-xs text-text-muted">Showing the 100 invoices with the most recovered.</p>
            ) : null}
          </Card>
        </>
      )}
    </div>
  );
}
