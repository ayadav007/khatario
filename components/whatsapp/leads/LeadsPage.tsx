'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { format, formatDistanceToNowStrict } from 'date-fns';
import { Download, Loader2, Plus, Search } from 'lucide-react';
import { ListPageHeader } from '@/components/layout/ListPageHeader';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Toast } from '@/components/ui/Toast';
import { STAGE_DOT, type StageOption } from '@/components/whatsapp/pipeline/stageStyle';
import type { LeadRow } from '@/lib/leads/list';
import { AddLeadDialog } from './AddLeadDialog';
import { LeadDrawer } from './LeadDrawer';
import {
  formatLeadPhone,
  LEAD_SOURCE_LABEL,
  LEAD_TYPE_LABEL,
  LEAD_TYPE_STYLE,
  leadsApi,
  sourceLabel,
  sourceStyle,
  TEMPERATURE_STYLE,
} from './leadLabels';

type Agent = { id: string; name: string; can_receive?: boolean };

/** Query keys the list and export routes read; the page keeps them in its own URL. */
const FILTER_KEYS = ['type', 'stage_id', 'source', 'owner', 'from', 'to', 'search', 'status'] as const;

const field =
  'rounded-lg border border-border bg-white px-3 py-2 text-sm text-text-primary dark:border-border-dark dark:bg-surface-dark';

export function LeadsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const filterQuery = useMemo(() => {
    const p = new URLSearchParams();
    for (const k of FILTER_KEYS) {
      const v = searchParams.get(k);
      if (v) p.set(k, v);
    }
    return p.toString();
  }, [searchParams]);
  const openLeadId = searchParams.get('lead');

  const [rows, setRows] = useState<LeadRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [isSupervisor, setIsSupervisor] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [stages, setStages] = useState<StageOption[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [search, setSearch] = useState(searchParams.get('search') || '');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);
  const loadSeq = useRef(0);

  /** Writes one or more query keys (empty value removes it), keeping the rest. */
  const setParams = useCallback(
    (changes: Record<string, string | null>) => {
      // The live URL, not the render's searchParams, so two quick changes do not undo each other.
      const p = new URLSearchParams(window.location.search);
      for (const [k, v] of Object.entries(changes)) {
        if (v) p.set(k, v);
        else p.delete(k);
      }
      const qs = p.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router],
  );

  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    const { ok, data } = await leadsApi<{ rows: LeadRow[]; total: number; is_supervisor: boolean }>(
      `/api/whatsapp/leads${filterQuery ? `?${filterQuery}` : ''}`,
    );
    if (seq !== loadSeq.current) return;
    if (!ok) {
      setToast({ message: data.error || 'Could not load leads', type: 'error' });
      setRows([]);
      setTotal(0);
      return;
    }
    setRows(data.rows || []);
    setTotal(data.total || 0);
    setIsSupervisor(!!data.is_supervisor);
  }, [filterQuery]);

  useEffect(() => {
    setRows(null);
    void load();
  }, [load]);

  useEffect(() => {
    void leadsApi('/api/whatsapp/pipeline/stages').then(({ data }) => setStages(data.stages || []));
    void leadsApi('/api/whatsapp/users').then(({ data }) =>
      setAgents((data.users || []).filter((u: Agent) => u.can_receive !== false)),
    );
  }, []);

  // Search is typed freely and written to the URL after a pause.
  useEffect(() => {
    const t = setTimeout(() => {
      const next = search.trim();
      if (next !== (new URLSearchParams(window.location.search).get('search') || '')) setParams({ search: next || null });
    }, 300);
    return () => clearTimeout(t);
  }, [search, setParams]);

  async function loadMore() {
    if (!rows) return;
    setLoadingMore(true);
    const seq = loadSeq.current;
    try {
      const p = new URLSearchParams(filterQuery);
      p.set('offset', String(rows.length));
      const { ok, data } = await leadsApi<{ rows: LeadRow[]; total: number }>(`/api/whatsapp/leads?${p.toString()}`);
      // The filters changed (and the list reloaded) while this page was on its way.
      if (seq !== loadSeq.current) return;
      if (!ok) {
        setToast({ message: data.error || 'Could not load more leads', type: 'error' });
        return;
      }
      setRows((prev) => [...(prev || []), ...(data.rows || []).filter((r) => !(prev || []).some((x) => x.id === r.id))]);
      setTotal(data.total || 0);
    } finally {
      setLoadingMore(false);
    }
  }

  async function exportCsv() {
    setExporting(true);
    try {
      const res = await fetch(`/api/whatsapp/leads/export${filterQuery ? `?${filterQuery}` : ''}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setToast({ message: data.error || (res.status === 403 ? 'You need the export permission for this' : 'Could not export'), type: 'error' });
        return;
      }
      const blob = await res.blob();
      const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '')?.[1] || 'leads.csv';
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }

  const hasFilters = filterQuery !== '';

  return (
    <div className="min-w-0 space-y-4 p-4 md:p-6">
      <ListPageHeader
        title="Leads"
        description="Every enquiry, from WhatsApp, ads, IndiaMART, calls and walk-ins. Click a lead to work on it."
        showActionsOnMobile
        actions={
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => void exportCsv()} disabled={exporting}>
              {exporting ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Download className="mr-1 h-4 w-4" />}
              Export
            </Button>
            <Button size="sm" onClick={() => setAddOpen(true)}>
              <Plus className="mr-1 h-4 w-4" />
              Add lead
            </Button>
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <label className="relative w-full min-w-0 sm:w-auto sm:min-w-[220px] sm:flex-1 md:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
          <input
            className={`${field} w-full pl-9`}
            placeholder="Search name or number"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search leads"
          />
        </label>
        <select className={field} value={searchParams.get('status') || ''} onChange={(e) => setParams({ status: e.target.value })} aria-label="Open or closed">
          <option value="">Open and closed</option>
          <option value="open">Open</option>
          <option value="closed">Closed</option>
        </select>
        <select className={field} value={searchParams.get('type') || ''} onChange={(e) => setParams({ type: e.target.value })} aria-label="Lead type">
          <option value="">New and existing</option>
          <option value="new">New</option>
          <option value="existing">Existing customers</option>
        </select>
        <select className={field} value={searchParams.get('stage_id') || ''} onChange={(e) => setParams({ stage_id: e.target.value })} aria-label="Stage">
          <option value="">All stages</option>
          {stages.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
        <select className={field} value={searchParams.get('source') || ''} onChange={(e) => setParams({ source: e.target.value })} aria-label="Lead source">
          <option value="">All sources</option>
          {Object.entries(LEAD_SOURCE_LABEL).map(([key, text]) => (
            <option key={key} value={key}>{text}</option>
          ))}
        </select>
        {isSupervisor && (
          <select className={field} value={searchParams.get('owner') || ''} onChange={(e) => setParams({ owner: e.target.value })} aria-label="Owner">
            <option value="">Everyone</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        )}
        <div className="flex min-w-0 flex-wrap items-center gap-1 text-xs text-text-secondary">
          <span>Opened</span>
          <input type="date" className={`${field} min-w-0`} value={searchParams.get('from') || ''} onChange={(e) => setParams({ from: e.target.value })} aria-label="Opened from" />
          <span>to</span>
          <input type="date" className={`${field} min-w-0`} value={searchParams.get('to') || ''} onChange={(e) => setParams({ to: e.target.value })} aria-label="Opened to" />
        </div>
        {hasFilters && (
          <button
            type="button"
            className="text-sm font-medium text-primary-600 hover:underline"
            onClick={() => {
              setSearch('');
              setParams(Object.fromEntries(FILTER_KEYS.map((k) => [k, null])));
            }}
          >
            Clear filters
          </button>
        )}
      </div>

      <Card padding="none" className="overflow-hidden">
        {!rows ? (
          <div className="flex items-center justify-center py-16 text-sm text-text-muted">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading leads…
          </div>
        ) : rows.length === 0 ? (
          <p className="px-4 py-16 text-center text-sm text-text-muted">
            {hasFilters ? 'No leads match these filters.' : 'No leads yet. They appear here when someone messages you, or add one by hand.'}
          </p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[960px] text-sm">
                <thead className="bg-surface-secondary text-left text-xs font-medium text-text-secondary dark:bg-surface-dark">
                  <tr>
                    <th className="px-3 py-2">Name</th>
                    <th className="px-3 py-2">Number</th>
                    <th className="px-3 py-2 text-right">Messages</th>
                    <th className="px-3 py-2">Type</th>
                    <th className="px-3 py-2">Source</th>
                    <th className="px-3 py-2">Stage</th>
                    <th className="px-3 py-2">Temperature</th>
                    <th className="px-3 py-2">Owner</th>
                    <th className="px-3 py-2">Opened</th>
                    <th className="px-3 py-2">Last activity</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border dark:divide-border-dark">
                  {rows.map((r) => (
                    <LeadTableRow key={r.id} row={r} stages={stages} onOpen={() => setParams({ lead: r.id })} />
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between border-t border-border px-3 py-2 text-xs text-text-secondary dark:border-border-dark">
              <span>
                Showing {rows.length} of {total}
              </span>
              {rows.length < total && (
                <Button variant="secondary" size="sm" onClick={() => void loadMore()} disabled={loadingMore}>
                  {loadingMore ? 'Loading…' : 'Load more'}
                </Button>
              )}
            </div>
          </>
        )}
      </Card>

      {addOpen && (
        <AddLeadDialog
          stages={stages}
          agents={agents}
          onClose={() => setAddOpen(false)}
          onSaved={(leadId, existing) => {
            setAddOpen(false);
            setToast(
              existing
                ? { message: 'This number already has an open lead', type: 'info' }
                : { message: 'Lead added', type: 'success' },
            );
            void load();
            setParams({ lead: leadId });
          }}
        />
      )}

      <LeadDrawer
        leadId={openLeadId}
        onClose={() => setParams({ lead: null })}
        onChanged={() => void load()}
        onOpenLead={(id) => setParams({ lead: id })}
      />

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}

function LeadTableRow({ row: r, stages, onOpen }: { row: LeadRow; stages: StageOption[]; onOpen: () => void }) {
  const stage = stages.find((s) => s.id === r.stage_id);
  return (
    <tr className="cursor-pointer hover:bg-surface-secondary/60 dark:hover:bg-surface-dark/60" onClick={onOpen}>
      <td className="max-w-[200px] px-3 py-2">
        <button
          type="button"
          className="block max-w-full truncate text-left font-medium text-text-primary hover:underline"
          onClick={(e) => {
            e.stopPropagation();
            onOpen();
          }}
        >
          {r.name}
        </button>
        {r.closed_at && <span className="text-[11px] text-text-muted">Closed</span>}
      </td>
      <td className="whitespace-nowrap px-3 py-2 text-text-secondary">{formatLeadPhone(r.phone)}</td>
      <td className="whitespace-nowrap px-3 py-2 text-right text-text-secondary">
        {r.message_count ?? <span className="text-xs text-text-muted">No chat yet</span>}
      </td>
      <td className="px-3 py-2">
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${LEAD_TYPE_STYLE[r.lead_type]}`}>{LEAD_TYPE_LABEL[r.lead_type]}</span>
      </td>
      <td className="px-3 py-2">
        <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ${sourceStyle(r.source)}`}>{sourceLabel(r.source)}</span>
      </td>
      <td className="whitespace-nowrap px-3 py-2 text-text-primary">
        {r.stage_name ? (
          <span className="inline-flex items-center gap-1.5">
            {stage && <span className={`h-2 w-2 rounded-full ${STAGE_DOT[stage.color]}`} />}
            {r.stage_name}
          </span>
        ) : (
          <span className="text-text-muted">—</span>
        )}
      </td>
      <td className="whitespace-nowrap px-3 py-2">
        {r.temperature && TEMPERATURE_STYLE[r.temperature] ? (
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium capitalize ${TEMPERATURE_STYLE[r.temperature]}`}>
            {r.temperature}
            {r.lead_score != null ? ` · ${r.lead_score}` : ''}
          </span>
        ) : r.lead_score != null ? (
          <span className="text-text-secondary">{r.lead_score}</span>
        ) : (
          <span className="text-text-muted">—</span>
        )}
      </td>
      <td className="whitespace-nowrap px-3 py-2 text-text-secondary">{r.owner_name || <span className="text-text-muted">—</span>}</td>
      <td className="whitespace-nowrap px-3 py-2 text-text-secondary" title={new Date(r.opened_at).toLocaleString()}>
        {format(new Date(r.opened_at), 'd MMM yyyy')}
      </td>
      <td className="whitespace-nowrap px-3 py-2 text-text-secondary" title={new Date(r.last_activity_at).toLocaleString()}>
        {formatDistanceToNowStrict(new Date(r.last_activity_at), { addSuffix: true })}
      </td>
    </tr>
  );
}
