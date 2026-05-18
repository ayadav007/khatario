'use client';

export const dynamic = 'force-dynamic';

import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { AlertTriangle } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useBranch } from '@/contexts/BranchContext';
import { useToastContext } from '@/contexts/ToastContext';
import { ReconciliationFilters } from '@/components/gst/ReconciliationFilters';
import { ReconciliationSummary } from '@/components/gst/ReconciliationSummary';
import { ReconciliationHeadTable } from '@/components/gst/ReconciliationHeadTable';
import {
  ReconciliationExceptions,
  reconciliationExceptionKey,
} from '@/components/gst/ReconciliationExceptions';
import { ReconciliationInvoiceTable } from '@/components/gst/ReconciliationInvoiceTable';
import type {
  Gstr13bReconciliationMode,
  Gstr13bReconciliationPayload,
  CategoryTaxBlock,
  ReconciliationException,
  ReconciliationExceptionType,
} from '@/components/gst/gstr13b-reconciliation-types';
import {
  reconciliationModeLabel,
  type GstAlertRecipient,
  type GstReconciliationAlertRow,
  type GstReconciliationOpenSeverityCounts,
} from '@/lib/gst/gstr13b-client';

function currentPeriodYm() {
  const now = new Date();
  const y = now.getFullYear();
  const m = (now.getMonth() + 1).toString().padStart(2, '0');
  return `${y}-${m}`;
}

function taxTotal(b: CategoryTaxBlock) {
  return b.igst + b.cgst + b.sgst + b.cess;
}

function fmtInr(n: number) {
  return `₹${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function PageSkeleton() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="h-24 rounded-xl bg-gray-200" />
      <div className="h-40 rounded-xl bg-gray-200" />
      <div className="h-56 rounded-xl bg-gray-200" />
      <div className="h-64 rounded-xl bg-gray-200" />
    </div>
  );
}

const CATEGORY_CARDS: {
  key: keyof Gstr13bReconciliationPayload['categories'];
  title: string;
  subtitle?: string;
}[] = [
  { key: 'outward_taxable', title: 'Outward taxable' },
  { key: 'zero_rated', title: 'Zero rated' },
  { key: 'inward_rcm', title: 'RCM (inward)' },
  { key: 'cdn_adjustments', title: 'CDN adjustments', subtitle: 'See note on 3B netting' },
];

const EMPTY_SEVERITY_COUNTS: GstReconciliationOpenSeverityCounts = {
  high: 0,
  medium: 0,
  low: 0,
  total: 0,
};

function Gstr13bReconciliationPageContent() {
  const searchParams = useSearchParams();
  const { business, user } = useAuth();
  const { accessibleBranches, currentBranchId } = useBranch();
  const toast = useToastContext();

  const [period, setPeriod] = useState(currentPeriodYm);
  const [mode, setMode] = useState<Gstr13bReconciliationMode>('live_vs_live');
  const [branchId, setBranchId] = useState<string | null>(null);
  const branchSeeded = useRef(false);

  const [data, setData] = useState<Gstr13bReconciliationPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [invoiceSearch, setInvoiceSearch] = useState('');
  const [invoiceExceptionFilter, setInvoiceExceptionFilter] = useState<'' | ReconciliationExceptionType>('');
  const [invoicePage, setInvoicePage] = useState(0);
  const [focusedDocumentId, setFocusedDocumentId] = useState<string | null>(null);
  const [activeExceptionKey, setActiveExceptionKey] = useState<string | null>(null);
  const [onlyMismatchedView, setOnlyMismatchedView] = useState(false);

  const branchOptions = useMemo(
    () =>
      (accessibleBranches ?? []).map((b) => ({
        id: b.id,
        name: b.name,
        branch_code: b.branch_code,
        gstin: b.gstin,
      })),
    [accessibleBranches]
  );

  const issuerGstin = useMemo(() => {
    if (branchId) {
      const b = branchOptions.find((x) => x.id === branchId);
      return (b?.gstin || business?.gstin || '').trim();
    }
    return (business?.gstin || '').trim();
  }, [branchId, branchOptions, business?.gstin]);

  const [openAlertCount, setOpenAlertCount] = useState(0);
  const [openSeverityCounts, setOpenSeverityCounts] =
    useState<GstReconciliationOpenSeverityCounts>(EMPTY_SEVERITY_COUNTS);
  const [openAlertsPreview, setOpenAlertsPreview] = useState<GstReconciliationAlertRow[]>([]);

  const [notifPrefsLoading, setNotifPrefsLoading] = useState(false);
  const [notifSaving, setNotifSaving] = useState(false);
  const [notifTestSending, setNotifTestSending] = useState(false);
  const [prefsScope, setPrefsScope] = useState<'branch' | 'business'>('branch');
  const [emailEnabled, setEmailEnabled] = useState(true);
  const [whatsappEnabled, setWhatsappEnabled] = useState(false);
  const [notifyHigh, setNotifyHigh] = useState(true);
  const [notifyMedium, setNotifyMedium] = useState(true);
  const [includeLow, setIncludeLow] = useState(false);
  const [cooldownMinutes, setCooldownMinutes] = useState(120);
  const [quietStart, setQuietStart] = useState('');
  const [quietEnd, setQuietEnd] = useState('');
  const [emailRecipientsText, setEmailRecipientsText] = useState('');
  const [whatsappRecipientsText, setWhatsappRecipientsText] = useState('');

  useEffect(() => {
    const p = searchParams.get('period');
    const m = searchParams.get('mode');
    const b = searchParams.get('branch_id');
    const v = searchParams.get('view');
    if (p && /^\d{4}-\d{2}$/.test(p)) setPeriod(p);
    if (m === 'live_vs_live' || m === 'filed_vs_live' || m === 'filed_vs_filed') {
      setMode(m as Gstr13bReconciliationMode);
    }
    if (b) {
      setBranchId(b);
      branchSeeded.current = true;
    }
    setOnlyMismatchedView(v === 'mismatches');
  }, [searchParams]);

  useEffect(() => {
    if (searchParams.get('branch_id')) return;
    if (branchSeeded.current) return;
    if (branchOptions.length === 0) return;
    branchSeeded.current = true;
    if (
      currentBranchId &&
      currentBranchId !== 'ALL' &&
      branchOptions.some((br) => br.id === currentBranchId)
    ) {
      setBranchId(currentBranchId);
    } else if (branchOptions.length === 1) {
      setBranchId(branchOptions[0].id);
    }
  }, [searchParams, branchOptions, currentBranchId]);

  const fetchReport = useCallback(async () => {
    if (!business?.id) return;
    setLoading(true);
    setError(null);
    try {
      const q = new URLSearchParams({ period, mode });
      if (branchId) q.set('branch_id', branchId);
      const res = await fetch(`/api/reports/gst/reconciliation?${q.toString()}`);
      const json = await res.json();
      if (!res.ok) {
        setData(null);
        setError(json.error || 'Failed to load reconciliation');
        toast.error(json.error || 'Failed to load reconciliation');
        return;
      }
      setData(json as Gstr13bReconciliationPayload);
      setInvoiceSearch('');
      setInvoiceExceptionFilter('');
      setInvoicePage(0);
      setFocusedDocumentId(null);
      setActiveExceptionKey(null);
    } catch (e) {
      console.error(e);
      setData(null);
      setError('Network error');
      toast.error('Network error');
    } finally {
      setLoading(false);
    }
  }, [business?.id, period, mode, branchId]);

  useEffect(() => {
    if (business?.id && user?.id) {
      fetchReport();
    }
  }, [business?.id, user?.id, fetchReport]);

  useEffect(() => {
    if (!business?.id || !period) return;
    let cancelled = false;
    (async () => {
      try {
        const q = new URLSearchParams({ period, status: 'open', mode, limit: '30' });
        if (branchId) q.set('branch_id', branchId);
        const res = await fetch(`/api/reports/gst/reconciliation/alerts?${q}`);
        const json = await res.json();
        if (!cancelled && res.ok) {
          setOpenAlertCount(Array.isArray(json.alerts) ? json.alerts.length : 0);
          setOpenSeverityCounts(
            json.open_counts_by_severity && typeof json.open_counts_by_severity === 'object'
              ? (json.open_counts_by_severity as GstReconciliationOpenSeverityCounts)
              : EMPTY_SEVERITY_COUNTS
          );
          setOpenAlertsPreview(Array.isArray(json.alerts) ? json.alerts.slice(0, 8) : []);
        }
      } catch {
        if (!cancelled) {
          setOpenAlertCount(0);
          setOpenSeverityCounts(EMPTY_SEVERITY_COUNTS);
          setOpenAlertsPreview([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [business?.id, period, branchId, mode]);

  useEffect(() => {
    if (!business?.id || !user?.id) return;
    let cancelled = false;
    (async () => {
      setNotifPrefsLoading(true);
      try {
        const q = branchId ? `?branch_id=${encodeURIComponent(branchId)}` : '';
        const res = await fetch(`/api/reports/gst/reconciliation/alerts/prefs${q}`);
        const json = await res.json();
        if (cancelled || !res.ok || !json.prefs) return;
        const p = json.prefs as {
          email_enabled: boolean;
          whatsapp_enabled: boolean;
          notify_on: string[];
          include_low: boolean;
          quiet_hours_start: string | null;
          quiet_hours_end: string | null;
          cooldown_minutes: number;
          recipients: GstAlertRecipient[] | unknown;
        };
        setEmailEnabled(!!p.email_enabled);
        setWhatsappEnabled(!!p.whatsapp_enabled);
        setIncludeLow(!!p.include_low);
        setNotifyHigh(Array.isArray(p.notify_on) ? p.notify_on.includes('high') : true);
        setNotifyMedium(Array.isArray(p.notify_on) ? p.notify_on.includes('medium') : true);
        setCooldownMinutes(
          typeof p.cooldown_minutes === 'number' && Number.isFinite(p.cooldown_minutes)
            ? p.cooldown_minutes
            : 120
        );
        setQuietStart(
          typeof p.quiet_hours_start === 'string' && p.quiet_hours_start
            ? p.quiet_hours_start.slice(0, 5)
            : ''
        );
        setQuietEnd(
          typeof p.quiet_hours_end === 'string' && p.quiet_hours_end
            ? p.quiet_hours_end.slice(0, 5)
            : ''
        );
        const rec = Array.isArray(p.recipients) ? (p.recipients as GstAlertRecipient[]) : [];
        setEmailRecipientsText(
          rec.filter((r) => r.type === 'email').map((r) => r.value).join(', ')
        );
        setWhatsappRecipientsText(
          rec.filter((r) => r.type === 'whatsapp').map((r) => r.value).join(', ')
        );
      } catch {
        /* ignore */
      } finally {
        if (!cancelled) setNotifPrefsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [business?.id, user?.id, branchId]);

  const saveNotificationPrefs = async () => {
    if (!business?.id) return;
    const notify_on: string[] = [];
    if (notifyHigh) notify_on.push('high');
    if (notifyMedium) notify_on.push('medium');
    if (notify_on.length === 0) {
      toast.error('Select at least High or Medium severity');
      return;
    }
    const splitList = (s: string) =>
      s
        .split(/[,;\n]+/)
        .map((x) => x.trim())
        .filter(Boolean);
    const recipients: GstAlertRecipient[] = [
      ...splitList(emailRecipientsText).map((value) => ({ type: 'email' as const, value })),
      ...splitList(whatsappRecipientsText).map((value) => ({ type: 'whatsapp' as const, value })),
    ];
    setNotifSaving(true);
    try {
      const res = await fetch('/api/reports/gst/reconciliation/alerts/prefs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apply_to: prefsScope,
          branch_id: branchId ?? undefined,
          email_enabled: emailEnabled,
          whatsapp_enabled: whatsappEnabled,
          notify_on,
          include_low: includeLow,
          quiet_hours_start: quietStart.trim() || null,
          quiet_hours_end: quietEnd.trim() || null,
          cooldown_minutes: cooldownMinutes,
          recipients,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error || 'Could not save notification settings');
        return;
      }
      toast.success('Notification preferences saved');
    } catch {
      toast.error('Network error saving preferences');
    } finally {
      setNotifSaving(false);
    }
  };

  const sendTestNotification = async () => {
    const a = openAlertsPreview[0];
    if (!a?.id) {
      toast.error('No open alert in the current filter — run reconciliation or widen filters');
      return;
    }
    setNotifTestSending(true);
    try {
      const res = await fetch(
        `/api/reports/gst/reconciliation/alerts/${encodeURIComponent(a.id)}/notify?force=true`,
        { method: 'POST' }
      );
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error || 'Could not queue notification');
        return;
      }
      toast.success('Test notification queued (email/WhatsApp per your settings)');
    } catch {
      toast.error('Network error');
    } finally {
      setNotifTestSending(false);
    }
  };

  const exceptionIdSets = useMemo(() => {
    const dateMismatch = new Set<string>();
    const cdnMismatch = new Set<string>();
    if (!data?.exceptions) return { dateMismatch, cdnMismatch };
    for (const ex of data.exceptions) {
      const id = ex.invoice_id || ex.document_id;
      if (!id) continue;
      if (ex.type === 'date_mismatch') dateMismatch.add(id);
      if (ex.type === 'cdn_mismatch') cdnMismatch.add(id);
    }
    return { dateMismatch, cdnMismatch };
  }, [data?.exceptions]);

  const onExceptionRowClick = (ex: ReconciliationException) => {
    const id = ex.invoice_id ?? ex.document_id ?? null;
    setFocusedDocumentId(id);
    setInvoiceExceptionFilter(ex.type);
    setInvoicePage(0);
    setActiveExceptionKey(reconciliationExceptionKey(ex));
    if (id) setInvoiceSearch(id);
  };

  const drillDownHref = (a: GstReconciliationAlertRow) => {
    const q = new URLSearchParams({
      period: a.gst_period,
      mode: a.mode,
      view: 'mismatches',
    });
    if (a.branch_id) q.set('branch_id', a.branch_id);
    return `/reports/gst/reconciliation?${q.toString()}`;
  };

  if (!business) {
    return (
      <div className="flex min-h-[320px] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary-600 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold text-text-primary">GSTR-1 vs GSTR-3B reconciliation</h1>
        <p className="text-sm text-text-secondary">
          Compare filed or live GSTR-1 heads with GSTR-3B (ledger basis), with voucher-level drill-down for audit.
        </p>
      </header>

      <ReconciliationFilters
        period={period}
        onPeriodChange={setPeriod}
        mode={mode}
        onModeChange={setMode}
        branches={branchOptions}
        branchId={branchId}
        onBranchChange={setBranchId}
        onRefresh={fetchReport}
        loading={loading}
      />

      <section className="rounded-xl border border-border bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-text-primary">GST alert notifications</h2>
        <p className="mt-1 text-xs text-text-secondary">
          Email and WhatsApp when reconciliation alerts open, severity increases, or difference spikes. Quiet hours use
          IST. Cooldown limits repeats per period and mode.
        </p>
        {notifPrefsLoading ? (
          <p className="mt-3 text-xs text-text-muted">Loading preferences…</p>
        ) : (
          <div className="mt-4 space-y-4 text-sm">
            <label className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-text-secondary">Save for</span>
              <select
                className="rounded-md border border-border bg-white px-2 py-1 text-xs"
                value={prefsScope}
                onChange={(e) => setPrefsScope(e.target.value === 'business' ? 'business' : 'branch')}
              >
                <option value="branch">This branch</option>
                <option value="business">Entire business</option>
              </select>
            </label>

            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={emailEnabled}
                  onChange={(e) => setEmailEnabled(e.target.checked)}
                />
                Email
              </label>
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={whatsappEnabled}
                  onChange={(e) => setWhatsappEnabled(e.target.checked)}
                />
                WhatsApp
              </label>
            </div>

            <div>
              <p className="text-xs font-medium text-text-secondary">Notify on severity</p>
              <div className="mt-2 flex flex-wrap gap-4">
                <label className="flex items-center gap-2 text-xs">
                  <input type="checkbox" checked={notifyHigh} onChange={(e) => setNotifyHigh(e.target.checked)} />
                  High
                </label>
                <label className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={notifyMedium}
                    onChange={(e) => setNotifyMedium(e.target.checked)}
                  />
                  Medium
                </label>
                <label className="flex items-center gap-2 text-xs">
                  <input type="checkbox" checked={includeLow} onChange={(e) => setIncludeLow(e.target.checked)} />
                  Include low
                </label>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <label className="block text-xs">
                <span className="font-medium text-text-secondary">Email recipients (comma-separated)</span>
                <textarea
                  className="mt-1 w-full rounded-md border border-border px-2 py-1.5 font-mono text-xs"
                  rows={2}
                  value={emailRecipientsText}
                  onChange={(e) => setEmailRecipientsText(e.target.value)}
                  placeholder="ca@firm.com, owner@company.in"
                />
              </label>
              <label className="block text-xs">
                <span className="font-medium text-text-secondary">WhatsApp (comma-separated)</span>
                <textarea
                  className="mt-1 w-full rounded-md border border-border px-2 py-1.5 font-mono text-xs"
                  rows={2}
                  value={whatsappRecipientsText}
                  onChange={(e) => setWhatsappRecipientsText(e.target.value)}
                  placeholder="9876543210 or +919876543210"
                />
              </label>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <label className="block text-xs">
                <span className="font-medium text-text-secondary">Cooldown (minutes)</span>
                <input
                  type="number"
                  min={0}
                  max={10080}
                  className="mt-1 w-full rounded-md border border-border px-2 py-1 text-xs"
                  value={cooldownMinutes}
                  onChange={(e) => setCooldownMinutes(parseInt(e.target.value, 10) || 0)}
                />
              </label>
              <label className="block text-xs">
                <span className="font-medium text-text-secondary">Quiet start (IST, optional)</span>
                <input
                  type="time"
                  className="mt-1 w-full rounded-md border border-border px-2 py-1 text-xs"
                  value={quietStart}
                  onChange={(e) => setQuietStart(e.target.value)}
                />
              </label>
              <label className="block text-xs">
                <span className="font-medium text-text-secondary">Quiet end (IST)</span>
                <input
                  type="time"
                  className="mt-1 w-full rounded-md border border-border px-2 py-1 text-xs"
                  value={quietEnd}
                  onChange={(e) => setQuietEnd(e.target.value)}
                />
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={saveNotificationPrefs}
                disabled={notifSaving}
                className="rounded-md bg-primary-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-700 disabled:opacity-50"
              >
                {notifSaving ? 'Saving…' : 'Save notification settings'}
              </button>
              <button
                type="button"
                onClick={sendTestNotification}
                disabled={notifTestSending || openAlertsPreview.length === 0}
                className="rounded-md border border-border bg-gray-50 px-3 py-1.5 text-xs font-medium text-text-primary hover:bg-gray-100 disabled:opacity-50"
              >
                {notifTestSending ? 'Queueing…' : 'Send test (first open alert, force)'}
              </button>
            </div>
          </div>
        )}
      </section>

      {openSeverityCounts.total > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-white px-4 py-2 text-xs">
          <span className="font-medium text-text-secondary">Open alerts (this filter):</span>
          <span className="font-semibold text-red-700">High {openSeverityCounts.high}</span>
          <span className="text-text-muted">·</span>
          <span className="font-semibold text-amber-800">Medium {openSeverityCounts.medium}</span>
          <span className="text-text-muted">·</span>
          <span className="font-semibold text-green-800">Low {openSeverityCounts.low}</span>
        </div>
      )}

      {openAlertsPreview.length > 0 && (
        <div className="rounded-xl border border-border bg-gray-50/80 px-4 py-3 text-sm">
          <p className="text-xs font-semibold text-text-primary">Drill-down from alert log</p>
          <ul className="mt-2 space-y-2">
            {openAlertsPreview.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="text-text-secondary">
                  <span className="font-mono text-text-primary">{a.gst_period}</span>
                  <span className="mx-1 text-text-muted">·</span>
                  {reconciliationModeLabel(a.mode)}
                  {a.severity ? (
                    <span className="ml-2 rounded border border-border bg-white px-1.5 py-0.5 capitalize">
                      {a.severity}
                    </span>
                  ) : null}
                </span>
                <Link
                  href={drillDownHref(a)}
                  className="text-primary-600 hover:text-primary-700 hover:underline"
                >
                  Open mismatches →
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] text-text-muted">
            Full lifecycle:{' '}
            <code className="rounded bg-gray-100 px-1">
              GET /api/reports/gst/reconciliation/alerts/history?alert_id=…
            </code>
          </p>
        </div>
      )}

      {onlyMismatchedView && (
        <p className="text-xs text-amber-900 border border-amber-200 bg-amber-50 rounded-lg px-3 py-2">
          Showing <strong>mismatch-only</strong> vouchers (deep link). Clear URL <code className="text-[11px]">view</code>{' '}
          or change filters to see all.
        </p>
      )}

      {loading && !data && <PageSkeleton />}

      {error && !loading && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-4 text-red-800">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
            <div>
              <p className="font-semibold">Could not load reconciliation</p>
              <p className="mt-1 text-sm">{error}</p>
            </div>
          </div>
        </div>
      )}

      {data && !loading && (
        <>
          {data.status === 'matched' ? (
            <div
              className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-900"
              role="status"
            >
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="font-semibold">
                  ✅ All GST data matches for this period
                </span>
              </div>
            </div>
          ) : data.insights?.quiet_mismatch ? (
            <div
              className="rounded-xl border border-amber-200 bg-amber-50/90 px-4 py-3 text-sm text-amber-950"
              role="status"
            >
              <span className="font-medium">{data.insights.insight_line}</span>
              {openAlertCount > 0 ? (
                <span className="ml-2 rounded-full border border-amber-200 bg-white px-2 py-0.5 text-xs text-amber-900">
                  {openAlertCount} open alert{openAlertCount === 1 ? '' : 's'}
                </span>
              ) : null}
            </div>
          ) : (
            <div
              className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900"
              role="status"
            >
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="font-semibold">
                  ❌ {data.insights?.insight_line ?? 'Mismatch — review heads and vouchers'}
                </span>
                {openAlertCount > 0 ? (
                  <span className="rounded-full border border-red-200 bg-white px-2 py-0.5 text-xs font-medium text-red-800">
                    {openAlertCount} open alert{openAlertCount === 1 ? '' : 's'} logged
                  </span>
                ) : null}
              </div>
            </div>
          )}

          {data.status === 'mismatch' && (data.insights?.top_exceptions?.length ?? data.exceptions.length) > 0 ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50/80 px-4 py-3 text-sm text-amber-950">
              <p className="font-semibold text-amber-900">Top exceptions (first 5)</p>
              <ul className="mt-2 space-y-1.5 text-xs">
                {(data.insights?.top_exceptions ?? data.exceptions.slice(0, 5)).map((ex, idx) => (
                  <li key={`${ex.type}-${ex.document_id ?? ex.invoice_id ?? idx}`} className="flex flex-wrap gap-x-2">
                    <span className="font-mono text-amber-950">
                      {ex.invoice_id ?? ex.document_id ?? '—'}
                    </span>
                    <span className="text-amber-900">{ex.type.replace(/_/g, ' ')}</span>
                    <span className="text-amber-800">{ex.details}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-text-secondary">
            <span>
              <span className="font-medium text-text-primary">Mode:</span>{' '}
              {data.insights?.context.mode_label ?? reconciliationModeLabel(mode)}
            </span>
            <span>
              <span className="font-medium text-text-primary">As of:</span>{' '}
              {data.insights?.context.as_of ?? new Date().toISOString().slice(0, 10)}
            </span>
            <span title="GSTR-1 head source vs GSTR-3B basis">
              <span className="font-medium text-text-primary">Source:</span>{' '}
              {data.insights?.context.source_line ??
                `${data.meta.gstr1_head_source === 'filed_snapshot' ? 'Snapshot' : 'Live'} vs ${
                  data.meta.gstr3b_source === 'filed_snapshot' ? 'Snapshot' : 'Ledger'
                }`}
            </span>
          </div>

          <ReconciliationSummary data={data} />

          {data.warnings.length > 0 && (
            <div
              className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-950"
              role="alert"
            >
              <p className="text-sm font-semibold text-amber-900">Warnings</p>
              <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-amber-950">
                {data.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          <ReconciliationHeadTable data={data} />

          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-text-primary">Category breakdown</h2>
            <p className="text-xs text-text-secondary">
              Taxable value and taxes by segment (GSTR-1 generator vs GSTR-3B sections). Subtotals may not match
              portal line-for-line where 3B aggregates supplies.
            </p>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {CATEGORY_CARDS.map(({ key, title, subtitle }) => {
                const c = data.categories[key];
                const g1t = taxTotal(c.gstr1);
                const g3t = taxTotal(c.gstr3b);
                const dt = taxTotal(c.difference);
                return (
                  <div
                    key={key}
                    className="rounded-xl border border-border bg-white p-4 shadow-sm"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
                      {subtitle && (
                        <span className="text-[10px] text-text-muted" title={c.note}>
                          {subtitle}
                        </span>
                      )}
                    </div>
                    {c.note && (
                      <p className="mt-1 text-[11px] text-amber-800 border border-amber-100 bg-amber-50/80 rounded px-2 py-1">
                        {c.note}
                      </p>
                    )}
                    <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
                      <div>
                        <dt className="text-text-muted">GSTR-1 (tax)</dt>
                        <dd className="mt-0.5 font-medium tabular-nums text-text-primary">{fmtInr(g1t)}</dd>
                        <dt className="mt-2 text-text-muted">Taxable</dt>
                        <dd className="tabular-nums text-text-secondary">{fmtInr(c.gstr1.taxable_value)}</dd>
                      </div>
                      <div>
                        <dt className="text-text-muted">GSTR-3B (tax)</dt>
                        <dd className="mt-0.5 font-medium tabular-nums text-text-primary">{fmtInr(g3t)}</dd>
                        <dt className="mt-2 text-text-muted">Taxable</dt>
                        <dd className="tabular-nums text-text-secondary">{fmtInr(c.gstr3b.taxable_value)}</dd>
                      </div>
                      <div>
                        <dt className="text-text-muted">Difference</dt>
                        <dd
                          className={`mt-0.5 font-semibold tabular-nums ${
                            Math.abs(dt) <= 1 ? 'text-green-700' : 'text-red-600'
                          }`}
                        >
                          {fmtInr(dt)}
                        </dd>
                      </div>
                    </dl>
                  </div>
                );
              })}
            </div>

            <details className="rounded-lg border border-border bg-gray-50/80 px-3 py-2 text-sm">
              <summary className="cursor-pointer font-medium text-text-secondary">
                Exempt & nil-rated (detail)
              </summary>
              <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                {(['exempt', 'nil_rated'] as const).map((key) => {
                  const c = data.categories[key];
                  const g1t = taxTotal(c.gstr1);
                  const g3t = taxTotal(c.gstr3b);
                  const dt = taxTotal(c.difference);
                  return (
                    <div key={key} className="rounded-lg border border-border bg-white p-3">
                      <h4 className="text-xs font-semibold capitalize text-text-primary">{key.replace('_', ' ')}</h4>
                      {c.note && <p className="mt-1 text-[11px] text-text-muted">{c.note}</p>}
                      <p className="mt-2 text-xs tabular-nums">
                        G1 {fmtInr(g1t)} · 3B {fmtInr(g3t)} · Δ {fmtInr(dt)}
                      </p>
                    </div>
                  );
                })}
              </div>
            </details>
          </section>

          <ReconciliationExceptions
            exceptions={data.exceptions}
            onRowClick={onExceptionRowClick}
            activeKey={activeExceptionKey}
          />

          <ReconciliationInvoiceTable
            data={data}
            issuerGstin={issuerGstin}
            onlyMismatchedVouchers={onlyMismatchedView}
            exceptionIdSets={exceptionIdSets}
            focusedDocumentId={focusedDocumentId}
            onClearFocus={() => {
              setFocusedDocumentId(null);
              setActiveExceptionKey(null);
            }}
            search={invoiceSearch}
            onSearchChange={setInvoiceSearch}
            exceptionFilter={invoiceExceptionFilter}
            onExceptionFilterChange={setInvoiceExceptionFilter}
            page={invoicePage}
            onPageChange={setInvoicePage}
          />
        </>
      )}
    </div>
  );
}

export default function Gstr13bReconciliationPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Gstr13bReconciliationPageContent />
    </Suspense>
  );
}
