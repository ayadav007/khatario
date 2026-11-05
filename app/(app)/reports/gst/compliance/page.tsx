'use client';

export const dynamic = 'force-dynamic';

import { PageHeader } from '@/components/layout/PageHeader';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Info, RefreshCw, Search, ShieldAlert, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useToastContext } from '@/contexts/ToastContext';
import { askAssistant } from '@/components/assistant/events';
import { MarkGstr3bFiledDialog } from '@/components/gst/MarkGstr3bFiled';
import { AlertDetailPanel, type AlertView } from '@/components/gst/alerts/AlertDetailPanel';
import {
  CHECK_ORDER,
  checkMeta,
  dateLabel,
  dateTimeLabel,
  documentSummary,
  dueLabel,
  inr,
  searchText,
  SEVERITY_ORDER,
  SEVERITY_STYLE,
  type CheckId,
  type GstAlert,
  type Severity,
} from '@/components/gst/alerts/alert-meta';

const CARD_ICON: Record<Severity, typeof Info> = { critical: ShieldAlert, warning: AlertTriangle, info: Info };
const CARD_TITLE: Record<Severity, string> = { critical: 'Act now', warning: 'Due soon', info: 'Reminders' };

function itcAtRisk(list: GstAlert[]) {
  return list.reduce((s, a) => s + (checkMeta(a.check_id).itc && a.amount ? a.amount : 0), 0);
}

export default function GstCompliancePage() {
  const { business } = useAuth();
  const toast = useToastContext();
  const [active, setActive] = useState<GstAlert[]>([]);
  const [dismissed, setDismissed] = useState<GstAlert[]>([]);
  const [resolved, setResolved] = useState<GstAlert[]>([]);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [skipped, setSkipped] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [assistantOn, setAssistantOn] = useState(false);
  const [marking, setMarking] = useState<{ period: string; label: string } | null>(null);
  const [rcmCoverage, setRcmCoverage] = useState<{
    status: string;
    approvedRules: number;
    action: string;
    explanation: string;
  } | null>(null);
  const [view, setView] = useState<AlertView>('active');
  const [search, setSearch] = useState('');
  const [checkFilter, setCheckFilter] = useState<CheckId | ''>('');
  const [severityFilter, setSeverityFilter] = useState<Severity | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    if (!business?.id) return;
    setLoading(true);
    try {
      const q = new URLSearchParams({ business_id: business.id });
      const res = await fetch(`/api/gst/compliance-alerts?${q}`);
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error || 'Could not check GST compliance');
        return;
      }
      setActive(json.alerts || []);
      setDismissed(json.dismissed || []);
      setResolved(json.resolved || []);
      setCheckedAt(json.checked_at || null);
      setSkipped(json.skipped || null);
    } catch {
      toast.error('Could not check GST compliance');
    } finally {
      setLoading(false);
    }
  }, [business?.id, toast]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/gst/rcm-coverage')
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { dashboard?: { status: string; approvedRules: number; action: string; explanation: string } } | null) => {
        if (!cancelled && data?.dashboard) setRcmCoverage(data.dashboard);
      })
      .catch(() => {
        if (!cancelled) setRcmCoverage(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    fetch('/api/assistant/chat?channel=trial_app', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : { enabled: false }))
      .then((d: { enabled?: boolean }) => setAssistantOn(Boolean(d.enabled)))
      .catch(() => setAssistantOn(false));
  }, []);

  const source = view === 'active' ? active : view === 'dismissed' ? dismissed : resolved;
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return source.filter(
      (a) =>
        (!checkFilter || a.check_id === checkFilter) &&
        (!severityFilter || view !== 'active' || a.severity === severityFilter) &&
        (!q || searchText(a).includes(q)),
    );
  }, [source, search, checkFilter, severityFilter, view]);

  const groups = useMemo(() => {
    const order = [...CHECK_ORDER, ...Array.from(new Set(visible.map((a) => a.check_id))).filter((c) => !CHECK_ORDER.includes(c))];
    return order
      .map((check) => ({ check, items: visible.filter((a) => a.check_id === check) }))
      .filter((g) => g.items.length > 0);
  }, [visible]);

  const selected = source.find((a) => a.id === selectedId) ?? null;
  const totalItc = itcAtRisk(active);

  async function post(alert: GstAlert, body: Record<string, unknown>, failure: string) {
    if (!business?.id) return false;
    setBusyId(alert.id);
    try {
      const res = await fetch('/api/gst/compliance-alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ business_id: business.id, alert_id: alert.id, ...body }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        toast.error(json.error || failure);
        return false;
      }
      return true;
    } finally {
      setBusyId(null);
    }
  }

  async function dismiss(alert: GstAlert, reason: string) {
    if (await post(alert, { action: 'dismiss', reason }, 'Could not dismiss')) {
      toast.success('Alert dismissed');
      setSelectedId(null);
      await load();
    }
  }

  async function restore(alert: GstAlert) {
    if (await post(alert, { action: 'restore' }, 'Could not restore the alert')) {
      toast.success('Alert is active again');
      setSelectedId(null);
      await load();
    }
  }

  async function postRule37Reversal(alert: GstAlert) {
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

  function switchView(next: AlertView) {
    setView(next);
    setSelectedId(null);
    if (next !== 'active') setSeverityFilter(null);
  }

  function toggleGroup(check: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(check)) next.delete(check);
      else next.add(check);
      return next;
    });
  }

  const tabs: Array<{ id: AlertView; label: string; count: number }> = [
    { id: 'active', label: 'Active', count: active.length },
    { id: 'resolved', label: 'Resolved this FY', count: resolved.length },
    { id: 'dismissed', label: 'Dismissed', count: dismissed.length },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={
          <span className="inline-flex flex-wrap items-center gap-3">
            GST Alert Center
            {active.length > 0 && (
              <span className="text-sm font-semibold px-2.5 py-0.5 rounded-md bg-amber-100 text-amber-800">
                {active.length} active
              </span>
            )}
          </span>
        }
        subtitle="Khatario checks your books every day against GST rules: Rule 37, the 30 November ITC and credit note deadline, GSTR-3B due dates, Rule 47A self-invoices, e-way bills and e-invoicing."
        actions={
          <div className="flex flex-wrap items-center gap-3">
            {checkedAt && (
              <span className="inline-flex items-center gap-1.5 text-sm text-gray-600">
                <CheckCircle2 className="w-4 h-4 text-green-600" />
                Last checked {dateTimeLabel(checkedAt)}
              </span>
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

      {!skipped && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {SEVERITY_ORDER.map((sev) => {
            const list = active.filter((a) => a.severity === sev);
            const itc = itcAtRisk(list);
            const Icon = CARD_ICON[sev];
            const on = view === 'active' && severityFilter === sev;
            return (
              <button
                key={sev}
                type="button"
                aria-pressed={on}
                onClick={() => {
                  switchView('active');
                  setSeverityFilter(on ? null : sev);
                }}
                className={`text-left rounded-xl border p-4 transition ${SEVERITY_STYLE[sev].card} ${on ? 'ring-2 ring-primary-500' : 'hover:shadow-sm'}`}
              >
                <div className="flex items-center gap-2 text-sm font-medium text-gray-800">
                  <Icon className="w-4 h-4" />
                  {CARD_TITLE[sev]}
                </div>
                <p className="mt-1 text-2xl font-bold text-gray-900">{list.length}</p>
                <p className="mt-0.5 text-xs text-gray-600">{itc > 0 ? `${inr(itc)} ITC at risk` : list.length ? 'No ITC at risk' : 'Nothing here'}</p>
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => switchView('resolved')}
            className={`text-left rounded-xl border border-green-200 bg-green-50/70 p-4 transition ${view === 'resolved' ? 'ring-2 ring-primary-500' : 'hover:shadow-sm'}`}
          >
            <div className="flex items-center gap-2 text-sm font-medium text-gray-800">
              <ShieldCheck className="w-4 h-4" />
              Resolved this FY
            </div>
            <p className="mt-1 text-2xl font-bold text-gray-900">{resolved.length}</p>
            <p className="mt-0.5 text-xs text-gray-600">Closed when the books were fixed</p>
          </button>
        </div>
      )}

      {rcmCoverage && (
        <section
          data-rcm-coverage-status="app-limitation"
          className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-950"
        >
          <p className="font-semibold">{rcmCoverage.status}</p>
          <p className="mt-1">Approved rules: {rcmCoverage.approvedRules}.</p>
          <p className="mt-1">{rcmCoverage.action}</p>
          <p className="mt-1">{rcmCoverage.explanation}</p>
        </section>
      )}

      {!skipped && (
        <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_400px] lg:gap-6 lg:items-start">
          <div className="min-w-0 space-y-4">
            <div className="flex gap-6 border-b border-gray-200 overflow-x-auto" role="tablist">
              {tabs.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={view === t.id}
                  onClick={() => switchView(t.id)}
                  className={`pb-2.5 -mb-px text-sm whitespace-nowrap border-b-2 ${
                    view === t.id ? 'border-primary-600 text-gray-900 font-semibold' : 'border-transparent text-gray-500 hover:text-gray-800'
                  }`}
                >
                  {t.label} ({t.count})
                </button>
              ))}
            </div>

            <div className="flex flex-col sm:flex-row gap-2">
              <label className="relative flex-1">
                <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <span className="sr-only">Search alerts</span>
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search by supplier, bill number or rule"
                  className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 rounded-lg bg-white"
                />
              </label>
              <select
                value={checkFilter}
                onChange={(e) => setCheckFilter(e.target.value as CheckId | '')}
                aria-label="Filter by rule"
                className="py-2 pl-3 pr-8 text-sm border border-gray-300 rounded-lg bg-white"
              >
                <option value="">All rules</option>
                {CHECK_ORDER.map((c) => (
                  <option key={c} value={c}>
                    {checkMeta(c).chip}
                  </option>
                ))}
              </select>
            </div>

            {severityFilter && view === 'active' && (
              <p className="text-sm text-gray-600">
                Showing {CARD_TITLE[severityFilter].toLowerCase()} only.{' '}
                <button type="button" onClick={() => setSeverityFilter(null)} className="text-primary-700 hover:underline">
                  Show all
                </button>
              </p>
            )}

            {!loading && groups.length === 0 && (
              <div className="bg-white border border-gray-200 rounded-xl p-8 text-center shadow-sm">
                <CheckCircle2 className="w-10 h-10 text-green-500 mx-auto" />
                <p className="mt-3 font-semibold text-gray-900">
                  {source.length > 0
                    ? 'No alerts match your search'
                    : view === 'active'
                      ? 'No GST alerts right now'
                      : view === 'resolved'
                        ? 'No alerts resolved this financial year yet'
                        : 'No dismissed alerts'}
                </p>
                {view === 'active' && source.length === 0 && (
                  <p className="text-sm text-gray-500 mt-1">We will notify you when a deadline comes close.</p>
                )}
              </div>
            )}

            {groups.map(({ check, items }) => {
              const meta = checkMeta(check);
              const top = SEVERITY_ORDER.find((s) => items.some((a) => a.severity === s)) ?? 'info';
              const sum = meta.impact ? items.reduce((s, a) => s + (a.amount ?? 0), 0) : 0;
              const open = !collapsed.has(check);
              return (
                <section key={check} className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
                  <button
                    type="button"
                    onClick={() => toggleGroup(check)}
                    aria-expanded={open}
                    className={`w-full flex items-center gap-3 px-4 py-3 text-left border-b ${
                      view === 'active' ? SEVERITY_STYLE[top].group : 'bg-gray-50 border-gray-200'
                    } ${open ? '' : 'border-b-0'}`}
                  >
                    {open ? <ChevronDown className="w-4 h-4 shrink-0" /> : <ChevronRight className="w-4 h-4 shrink-0" />}
                    <span className="flex-1 min-w-0 text-sm font-semibold text-gray-900">
                      {meta.group} <span className="font-normal text-gray-600">({items.length})</span>
                    </span>
                    {sum > 0 && (
                      <span className="text-sm font-semibold text-gray-900 whitespace-nowrap">
                        {inr(sum)} <span className="font-normal text-gray-600">{meta.impact?.toLowerCase()}</span>
                      </span>
                    )}
                  </button>
                  {open && (
                    <ul className="divide-y divide-gray-100">
                      {items.map((a) => (
                        <AlertRow key={a.id} alert={a} view={view} selected={a.id === selectedId} onSelect={() => setSelectedId(a.id)} />
                      ))}
                    </ul>
                  )}
                </section>
              );
            })}

            <p className="text-xs text-gray-500">
              Alerts close by themselves once your books no longer show the problem. Alerts are general information from the GST law
              applied to your books, not tax advice. Due dates and fees can change by notification; please check with your CA for your
              case.
            </p>
          </div>

          <aside
            className={
              selected
                ? 'fixed inset-0 z-40 bg-black/30 flex justify-end lg:sticky lg:inset-auto lg:top-4 lg:z-auto lg:bg-transparent lg:block'
                : 'hidden lg:block lg:sticky lg:top-4'
            }
            onClick={(e) => {
              if (e.target === e.currentTarget) setSelectedId(null);
            }}
          >
            {selected ? (
              <div className="h-full w-full max-w-md overflow-y-auto bg-white lg:h-auto lg:max-w-none lg:max-h-[calc(100vh-2rem)] lg:bg-transparent">
                <AlertDetailPanel
                  alert={selected}
                  view={view}
                  busy={busyId === selected.id}
                  assistantOn={assistantOn}
                  onClose={() => setSelectedId(null)}
                  onPostReversal={postRule37Reversal}
                  onMarkFiled={(a) => setMarking({ period: a.details.period!, label: a.details.label || a.details.period! })}
                  onAsk={(q) => askAssistant(q)}
                  onDismiss={dismiss}
                  onRestore={restore}
                />
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500">
                {source.length ? 'Select an alert to see the bills behind it, the rule and what to do next.' : 'Nothing to show here.'}
              </div>
            )}
          </aside>
        </div>
      )}

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
    </div>
  );
}

function AlertRow({ alert, view, selected, onSelect }: { alert: GstAlert; view: AlertView; selected: boolean; onSelect: () => void }) {
  const meta = checkMeta(alert.check_id);
  const style = SEVERITY_STYLE[alert.severity];
  const due = view === 'active' ? dueLabel(alert) : null;
  const summary = documentSummary(alert);
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected}
        className={`w-full text-left px-4 py-3 grid grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[minmax(0,1fr)_120px_120px_100px] gap-x-4 gap-y-1 items-center hover:bg-gray-50 ${
          selected ? 'relative bg-primary-50/60 before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-primary-600' : ''
        }`}
      >
        <span className="min-w-0 flex items-start gap-2.5">
          <span className={`mt-1.5 h-2 w-2 rounded-full shrink-0 ${view === 'active' ? style.dot : 'bg-gray-300'}`} />
          <span className="min-w-0">
            <span className="block text-sm font-medium text-gray-900">{alert.title}</span>
            {summary && <span className="block text-xs text-gray-500 truncate">{summary}</span>}
          </span>
        </span>
        <span className="text-sm font-semibold text-gray-900 text-right md:order-none">
          {meta.impact && alert.amount != null && alert.amount > 0 ? inr(alert.amount) : <span className="text-gray-400">—</span>}
        </span>
        <span className="col-start-1 md:col-start-auto pl-[18px] md:pl-0 text-xs">
          {due ? (
            <span className={`inline-block px-2 py-0.5 rounded-md ${due.late ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-800'}`}>{due.text}</span>
          ) : view === 'resolved' && alert.resolved_at ? (
            <span className="text-gray-500">{dateLabel(alert.resolved_at)}</span>
          ) : view === 'dismissed' && alert.dismissed_at ? (
            <span className="text-gray-500">{dateLabel(alert.dismissed_at)}</span>
          ) : null}
        </span>
        <span className="hidden md:block text-right">
          <span
            className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
              view === 'active' ? style.pill : view === 'resolved' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-700'
            }`}
          >
            {view === 'active' ? style.label : view === 'resolved' ? 'Resolved' : 'Dismissed'}
          </span>
        </span>
      </button>
    </li>
  );
}
