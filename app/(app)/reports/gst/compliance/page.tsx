'use client';

export const dynamic = 'force-dynamic';

import { PageHeader } from '@/components/layout/PageHeader';
import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, BellOff, CheckCircle2, Info, MessageCircle, RefreshCw, ShieldAlert } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useToastContext } from '@/contexts/ToastContext';
import { askAssistant } from '@/components/assistant/events';
import { MarkGstr3bFiledDialog } from '@/components/gst/MarkGstr3bFiled';

type Severity = 'info' | 'warning' | 'critical';

interface Alert {
  id: string;
  check_id: string;
  alert_key: string;
  severity: Severity;
  stage: string;
  title: string;
  message: string;
  legal_ref: string;
  action_url: string | null;
  action_label: string | null;
  ask_question: string | null;
  due_date: string | null;
  amount: number | null;
  details: {
    bills?: Array<{ purchase_id: string; bill_number: string | null; bill_date: string; supplier_name: string | null; unpaid: number; itc_at_stake: number; to_reverse?: number; days_outstanding: number }>;
    invoices?: Array<{ supplier_gstin: string; supplier_name: string | null; invoice_number: string; invoice_date: string; itc: number }>;
    sales?: Array<{ invoice_id: string; invoice_number: string; invoice_date: string; customer_name: string | null; grand_total: number }>;
    rcm_bills?: Array<{ purchase_id: string; bill_number: string | null; bill_date: string; supplier_name: string | null; self_invoice_by: string; tax: number }>;
    period?: string;
    label?: string;
    can_mark_filed?: boolean;
  };
  dismissed: boolean;
}

const STYLE: Record<Severity, { box: string; badge: string; label: string; Icon: typeof Info }> = {
  critical: { box: 'border-red-200 bg-red-50/60', badge: 'bg-red-100 text-red-800', label: 'Act now', Icon: ShieldAlert },
  warning: { box: 'border-amber-200 bg-amber-50/60', badge: 'bg-amber-100 text-amber-800', label: 'Due soon', Icon: AlertTriangle },
  info: { box: 'border-sky-200 bg-sky-50/50', badge: 'bg-sky-100 text-sky-800', label: 'Reminder', Icon: Info },
};

function inr(n: number) {
  return `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

function dateLabel(iso: string) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function GstCompliancePage() {
  const { business } = useAuth();
  const toast = useToastContext();
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [dismissedCount, setDismissedCount] = useState(0);
  const [skipped, setSkipped] = useState<string | null>(null);
  const [showDismissed, setShowDismissed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [assistantOn, setAssistantOn] = useState(false);
  const [marking, setMarking] = useState<{ period: string; label: string } | null>(null);

  const load = useCallback(async () => {
    if (!business?.id) return;
    setLoading(true);
    try {
      const q = new URLSearchParams({ business_id: business.id, include_dismissed: String(showDismissed) });
      const res = await fetch(`/api/gst/compliance-alerts?${q}`);
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error || 'Could not check GST compliance');
        return;
      }
      setAlerts(json.alerts || []);
      setDismissedCount(json.dismissed_count || 0);
      setSkipped(json.skipped || null);
    } catch {
      toast.error('Could not check GST compliance');
    } finally {
      setLoading(false);
    }
  }, [business?.id, showDismissed, toast]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    fetch('/api/assistant/chat?channel=trial_app', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : { enabled: false }))
      .then((d: { enabled?: boolean }) => setAssistantOn(Boolean(d.enabled)))
      .catch(() => setAssistantOn(false));
  }, []);

  async function dismiss(alert: Alert) {
    if (!business?.id) return;
    setBusyId(alert.id);
    try {
      const res = await fetch('/api/gst/compliance-alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ business_id: business.id, alert_id: alert.id, action: 'dismiss' }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        toast.error(json.error || 'Could not dismiss');
        return;
      }
      await load();
    } finally {
      setBusyId(null);
    }
  }

  async function postRule37Reversal(alert: Alert) {
    if (!business?.id) return;
    const amount = alert.amount != null ? inr(alert.amount) : 'the ITC';
    if (!window.confirm(`Post a reversal of ${amount} ITC for bills unpaid over 180 days? It is re-claimed in the books when you pay the supplier.`)) {
      return;
    }
    setBusyId(alert.id);
    try {
      const res = await fetch('/api/gst/rule37', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ business_id: business.id }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(json.error || 'Could not post the reversal');
        return;
      }
      toast.success('ITC reversal posted');
      await load();
    } finally {
      setBusyId(null);
    }
  }

  const visible = alerts.filter((a) => showDismissed || !a.dismissed);

  return (
    <div className="space-y-6">
      <PageHeader
  title="GST alerts"
  subtitle="Khatario checks your books every day against GST rules: supplier bills nearing 180 days unpaid (Rule 37), the 30 November last date for last year&apos;s ITC and credit notes, GSTR-3B due dates, e-way bills, e-invoicing and reverse charge self-invoices."

  actions={
    <>
<div className="flex items-center gap-3">
          {dismissedCount > 0 && (
            <button
              type="button"
              onClick={() => setShowDismissed((v) => !v)}
              className="text-sm text-gray-600 hover:text-gray-900 underline-offset-2 hover:underline"
            >
              {showDismissed ? 'Hide dismissed' : `Show dismissed (${dismissedCount})`}
            </button>
          )}
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="inline-flex items-center gap-2 px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white hover:bg-gray-50 disabled:opacity-60"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Check again
          </button>
        </div>
    </>
  }
/>

      {skipped && (
        <p className="text-sm text-gray-700 bg-gray-50 border border-gray-200 rounded-lg px-4 py-3">
          These checks apply to businesses registered under GST, and your business profile has no GSTIN. If that is wrong,
          update GST details in{' '}
          <Link href="/settings/business#bp-gst" className="text-primary-700 hover:underline">
            Business profile
          </Link>
          .
        </p>
      )}

      {!loading && !skipped && visible.length === 0 && (
        <div className="bg-white border border-gray-200 rounded-xl p-8 text-center shadow-sm">
          <CheckCircle2 className="w-10 h-10 text-green-500 mx-auto" />
          <p className="mt-3 font-semibold text-gray-900">No GST alerts right now</p>
          <p className="text-sm text-gray-500 mt-1">We will notify you when a deadline comes close.</p>
        </div>
      )}

      <div className="space-y-4">
        {visible.map((a) => {
          const s = STYLE[a.severity];
          const rows = a.details.bills ?? [];
          const invoices = a.details.invoices ?? [];
          const sales = a.details.sales ?? [];
          const rcmBills = a.details.rcm_bills ?? [];
          return (
            <div key={a.id} className={`border rounded-xl p-5 shadow-sm ${s.box} ${a.dismissed ? 'opacity-60' : ''}`}>
              <div className="flex items-start gap-3">
                <s.Icon className="w-5 h-5 mt-0.5 shrink-0 text-gray-700" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${s.badge}`}>{s.label}</span>
                    {a.due_date && <span className="text-xs text-gray-600">By {dateLabel(a.due_date)}</span>}
                    {a.amount != null && a.amount > 0 && <span className="text-xs font-medium text-gray-800">{inr(a.amount)}</span>}
                  </div>
                  <h2 className="mt-1.5 text-base font-semibold text-gray-900">{a.title}</h2>
                  <p className="mt-1 text-sm text-gray-700">{a.message}</p>
                  <p className="mt-2 text-xs text-gray-500">{a.legal_ref}</p>

                  {rows.length > 0 && (
                    <div className="mt-3 overflow-x-auto">
                      <table className="min-w-full text-xs">
                        <thead>
                          <tr className="text-left text-gray-500">
                            <th className="py-1 pr-4 font-medium">Bill</th>
                            <th className="py-1 pr-4 font-medium">Supplier</th>
                            <th className="py-1 pr-4 font-medium">Days unpaid</th>
                            <th className="py-1 pr-4 font-medium text-right">Unpaid</th>
                            <th className="py-1 font-medium text-right">ITC at stake</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.slice(0, 8).map((b) => (
                            <tr key={b.purchase_id} className="border-t border-gray-200/70">
                              <td className="py-1 pr-4">
                                <Link href={`/purchases/${b.purchase_id}`} className="text-primary-700 hover:underline">
                                  {b.bill_number || 'Bill'}
                                </Link>{' '}
                                <span className="text-gray-500">{dateLabel(b.bill_date)}</span>
                              </td>
                              <td className="py-1 pr-4 text-gray-700">{b.supplier_name || '—'}</td>
                              <td className="py-1 pr-4 text-gray-700">{b.days_outstanding}</td>
                              <td className="py-1 pr-4 text-right text-gray-700">{inr(b.unpaid)}</td>
                              <td className="py-1 text-right text-gray-900">{inr(b.to_reverse ?? b.itc_at_stake)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {rows.length > 8 && <p className="text-xs text-gray-500 mt-1">and {rows.length - 8} more</p>}
                    </div>
                  )}

                  {invoices.length > 0 && (
                    <div className="mt-3 overflow-x-auto">
                      <table className="min-w-full text-xs">
                        <thead>
                          <tr className="text-left text-gray-500">
                            <th className="py-1 pr-4 font-medium">Supplier</th>
                            <th className="py-1 pr-4 font-medium">Invoice</th>
                            <th className="py-1 font-medium text-right">ITC</th>
                          </tr>
                        </thead>
                        <tbody>
                          {invoices.slice(0, 8).map((d) => (
                            <tr key={`${d.supplier_gstin}-${d.invoice_number}`} className="border-t border-gray-200/70">
                              <td className="py-1 pr-4 text-gray-700">{d.supplier_name || d.supplier_gstin}</td>
                              <td className="py-1 pr-4 text-gray-700">
                                {d.invoice_number} <span className="text-gray-500">{dateLabel(d.invoice_date)}</span>
                              </td>
                              <td className="py-1 text-right text-gray-900">{inr(d.itc)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {invoices.length > 8 && <p className="text-xs text-gray-500 mt-1">and {invoices.length - 8} more</p>}
                    </div>
                  )}

                  {sales.length > 0 && (
                    <div className="mt-3 overflow-x-auto">
                      <table className="min-w-full text-xs">
                        <thead>
                          <tr className="text-left text-gray-500">
                            <th className="py-1 pr-4 font-medium">Invoice</th>
                            <th className="py-1 pr-4 font-medium">Customer</th>
                            <th className="py-1 font-medium text-right">Value</th>
                          </tr>
                        </thead>
                        <tbody>
                          {sales.slice(0, 8).map((d) => (
                            <tr key={d.invoice_id} className="border-t border-gray-200/70">
                              <td className="py-1 pr-4">
                                <Link href={`/invoices/${d.invoice_id}`} className="text-primary-700 hover:underline">
                                  {d.invoice_number}
                                </Link>{' '}
                                <span className="text-gray-500">{dateLabel(d.invoice_date)}</span>
                              </td>
                              <td className="py-1 pr-4 text-gray-700">{d.customer_name || '—'}</td>
                              <td className="py-1 text-right text-gray-900">{inr(d.grand_total)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {sales.length > 8 && <p className="text-xs text-gray-500 mt-1">and {sales.length - 8} more</p>}
                    </div>
                  )}

                  {rcmBills.length > 0 && (
                    <div className="mt-3 overflow-x-auto">
                      <table className="min-w-full text-xs">
                        <thead>
                          <tr className="text-left text-gray-500">
                            <th className="py-1 pr-4 font-medium">Bill</th>
                            <th className="py-1 pr-4 font-medium">Supplier</th>
                            <th className="py-1 pr-4 font-medium">Self-invoice by</th>
                            <th className="py-1 font-medium text-right">Tax</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rcmBills.slice(0, 8).map((b) => (
                            <tr key={b.purchase_id} className="border-t border-gray-200/70">
                              <td className="py-1 pr-4">
                                <Link href={`/purchases/${b.purchase_id}`} className="text-primary-700 hover:underline">
                                  {b.bill_number || 'Bill'}
                                </Link>{' '}
                                <span className="text-gray-500">{dateLabel(b.bill_date)}</span>
                              </td>
                              <td className="py-1 pr-4 text-gray-700">{b.supplier_name || '—'}</td>
                              <td className="py-1 pr-4 text-gray-700">{dateLabel(b.self_invoice_by)}</td>
                              <td className="py-1 text-right text-gray-900">{inr(b.tax)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {rcmBills.length > 8 && <p className="text-xs text-gray-500 mt-1">and {rcmBills.length - 8} more</p>}
                    </div>
                  )}

                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    {a.alert_key === 'rule37:reversal_pending' ? (
                      <button
                        type="button"
                        disabled={busyId === a.id}
                        onClick={() => postRule37Reversal(a)}
                        className="px-3 py-1.5 text-sm font-medium rounded-lg bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-60"
                      >
                        {a.action_label || 'Post ITC reversal'}
                      </button>
                    ) : (
                      a.action_url && (
                        <Link
                          href={a.action_url}
                          className="px-3 py-1.5 text-sm font-medium rounded-lg bg-primary-600 text-white hover:bg-primary-700"
                        >
                          {a.action_label || 'Open'}
                        </Link>
                      )
                    )}
                    {a.details.can_mark_filed && a.details.period && (
                      <button
                        type="button"
                        onClick={() => setMarking({ period: a.details.period!, label: a.details.label || a.details.period! })}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-primary-600 text-primary-700 bg-white hover:bg-primary-50"
                      >
                        <CheckCircle2 className="w-4 h-4" />
                        Mark as filed
                      </button>
                    )}
                    {assistantOn && a.ask_question && (
                      <button
                        type="button"
                        onClick={() => askAssistant(a.ask_question!)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-gray-300 bg-white hover:bg-gray-50"
                      >
                        <MessageCircle className="w-4 h-4" />
                        Ask why
                      </button>
                    )}
                    {!a.dismissed && (
                      <button
                        type="button"
                        disabled={busyId === a.id}
                        onClick={() => dismiss(a)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg text-gray-600 hover:bg-white/70 disabled:opacity-60"
                        title="Hide until this alert changes"
                      >
                        <BellOff className="w-4 h-4" />
                        Dismiss
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {marking && business?.id && (
        <MarkGstr3bFiledDialog
          businessId={business.id}
          period={marking.period}
          label={marking.label}
          onClose={() => setMarking(null)}
          onSaved={() => {
            setMarking(null);
            load();
          }}
        />
      )}

      <p className="text-xs text-gray-500">
        Alerts are general information from the GST law applied to your books, not tax advice. Due dates and fees can change by
        notification; please check with your CA for your case.
      </p>
    </div>
  );
}
