'use client';

export const dynamic = 'force-dynamic';

import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useToastContext } from '@/contexts/ToastContext';
import type { MatchSuggestion } from '@/lib/bank/reconciliation-engine';
import {
  bankLineFlow,
  matchReasonTooltipText,
  partialBreakdownRows,
  suggestionHeadline,
  tierBadgeClass,
} from '@/lib/bank/reconciliation-ui-helpers';
import { AlertTriangle, ChevronDown, ChevronRight, Search } from 'lucide-react';

const REC_NOTE_STORAGE_PREFIX = 'bank-reconciliation-note:';

type StatementLine = {
  id: string;
  transaction_date: string;
  description: string;
  debit_amount: string;
  credit_amount: string;
  balance: string;
  match_status: string;
  matched_ledger_ids: string[];
  is_matched: boolean;
  age_days?: number;
  extracted_references?: { long_numeric_refs: string[]; cheque_refs: string[] };
  is_duplicate?: boolean;
};

type LedgerLine = {
  id: string;
  entry_date: string;
  debit: string;
  credit: string;
  narration: string | null;
  reference_number: string | null;
};

type RecPayload = {
  statement: {
    id: string;
    bank_account_id: string;
    statement_period_start: string;
    statement_period_end: string;
    opening_balance: string;
    closing_balance: string;
    file_name: string | null;
    reconciliation_status?: string;
  };
  lines: StatementLine[];
  ledger_lines: LedgerLine[];
  suggestions: MatchSuggestion[];
  summary: {
    opening_balance: number;
    closing_balance: number;
    difference: number;
    reconciliation_difference: number;
    ledger_book_balance: number;
    matched_count: number;
    unmatched_count: number;
    ignored_count: number;
    total_lines: number;
  };
};

function fmt(n: string | number) {
  const x = typeof n === 'string' ? parseFloat(n) : n;
  if (!Number.isFinite(x)) return '—';
  return x.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function BankReconciliationPageContent() {
  const { business, user } = useAuth();
  const toast = useToastContext();
  const searchParams = useSearchParams();
  const urlStatementId = searchParams.get('bank_statement_id');

  const [accounts, setAccounts] = useState<
    { id: string; account_name: string; bank_name: string; ledger_account_id: string | null }[]
  >([]);
  const [bankAccountId, setBankAccountId] = useState('');
  const [statements, setStatements] = useState<
    { id: string; statement_period_start: string; statement_period_end: string; reconciliation_status?: string }[]
  >([]);
  const [statementId, setStatementId] = useState<string | null>(urlStatementId);
  const [data, setData] = useState<RecPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedBankLineId, setSelectedBankLineId] = useState<string | null>(null);
  const [selectedLedgerIds, setSelectedLedgerIds] = useState<Set<string>>(() => new Set());
  const [acting, setActing] = useState(false);
  const [showCreateEntry, setShowCreateEntry] = useState(false);
  const [entryType, setEntryType] = useState<'bank_charge' | 'interest'>('bank_charge');
  const [entryAccountId, setEntryAccountId] = useState('');
  const [expenseAccounts, setExpenseAccounts] = useState<{ id: string; account_name: string; account_code: string }[]>(
    []
  );
  const [incomeAccounts, setIncomeAccounts] = useState<{ id: string; account_name: string; account_code: string }[]>(
    []
  );

  const [bulkSelectedIds, setBulkSelectedIds] = useState<Set<string>>(() => new Set());
  const [expandedBankLineIds, setExpandedBankLineIds] = useState<Set<string>>(() => new Set());
  const [filterUnmatchedOnly, setFilterUnmatchedOnly] = useState(false);
  const [filterAgeOver30, setFilterAgeOver30] = useState(false);
  const [filterDuplicatesOnly, setFilterDuplicatesOnly] = useState(false);
  const [filterPartialOnly, setFilterPartialOnly] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [recNote, setRecNote] = useState('');

  const isCompleted = data?.statement?.reconciliation_status === 'completed';
  const busy = acting || loading;

  const loadAccounts = useCallback(async () => {
    if (!business?.id || !user?.id) return;
    const res = await fetch(
      `/api/bank-accounts?business_id=${encodeURIComponent(business.id)}&user_id=${encodeURIComponent(user.id)}`
    );
    const j = await res.json();
    if (res.ok && Array.isArray(j.accounts)) {
      const withLedger = j.accounts.filter((a: { ledger_account_id?: string }) => a.ledger_account_id);
      setAccounts(withLedger);
      if (withLedger.length === 1) setBankAccountId(withLedger[0].id);
    }
  }, [business?.id, user?.id]);

  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);

  useEffect(() => {
    if (urlStatementId) setStatementId(urlStatementId);
  }, [urlStatementId]);

  useEffect(() => {
    setData(null);
    setBulkSelectedIds(new Set());
    setExpandedBankLineIds(new Set());
    setSelectedBankLineId(null);
    setSelectedLedgerIds(new Set());
  }, [statementId]);

  const selectAllRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!statementId) {
      setRecNote('');
      return;
    }
    try {
      setRecNote(localStorage.getItem(REC_NOTE_STORAGE_PREFIX + statementId) ?? '');
    } catch {
      setRecNote('');
    }
  }, [statementId]);

  useEffect(() => {
    if (!statementId) return;
    const t = window.setTimeout(() => {
      try {
        localStorage.setItem(REC_NOTE_STORAGE_PREFIX + statementId, recNote);
      } catch {
        /* ignore quota */
      }
    }, 450);
    return () => window.clearTimeout(t);
  }, [recNote, statementId]);

  const loadStatements = useCallback(async () => {
    if (!business?.id || !user?.id || !bankAccountId) return;
    const res = await fetch(
      `/api/bank/reconciliation?business_id=${encodeURIComponent(business.id)}&user_id=${encodeURIComponent(user.id)}&bank_account_id=${encodeURIComponent(bankAccountId)}`
    );
    const j = await res.json();
    if (res.ok && Array.isArray(j.statements)) {
      setStatements(j.statements);
      if (j.statements.length && !statementId && !urlStatementId) {
        setStatementId(j.statements[0].id);
      }
    }
  }, [business?.id, user?.id, bankAccountId, statementId, urlStatementId]);

  useEffect(() => {
    if (bankAccountId) loadStatements();
  }, [bankAccountId, loadStatements]);

  useEffect(() => {
    if (data?.statement?.bank_account_id) {
      setBankAccountId((b) => b || data.statement.bank_account_id);
    }
  }, [data?.statement?.bank_account_id]);

  const loadRec = useCallback(async () => {
    if (!business?.id || !user?.id || !statementId) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/bank/reconciliation?business_id=${encodeURIComponent(business.id)}&user_id=${encodeURIComponent(user.id)}&bank_statement_id=${encodeURIComponent(statementId)}`
      );
      const j = await res.json();
      if (!res.ok) {
        toast.error(j.error || 'Failed to load');
        setData(null);
        return;
      }
      setData(j as RecPayload);
    } catch {
      toast.error('Network error');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [business?.id, user?.id, statementId, toast]);

  useEffect(() => {
    if (statementId) loadRec();
  }, [statementId, loadRec]);

  const suggestMap = useMemo(() => {
    const m = new Map<string, MatchSuggestion>();
    for (const s of data?.suggestions ?? []) m.set(s.bankLineId, s);
    return m;
  }, [data?.suggestions]);

  const ledgerById = useMemo(() => {
    const m = new Map<string, LedgerLine>();
    for (const l of data?.ledger_lines ?? []) m.set(l.id, l);
    return m;
  }, [data?.ledger_lines]);

  const filteredLines = useMemo(() => {
    if (!data?.lines) return [];
    const q = searchQuery.trim().toLowerCase();
    return data.lines.filter((l) => {
      if (filterUnmatchedOnly && l.match_status !== 'unmatched') return false;
      if (filterPartialOnly && l.match_status !== 'partial') return false;
      if (filterAgeOver30 && (l.age_days == null || l.age_days <= 30)) return false;
      if (filterDuplicatesOnly && !l.is_duplicate) return false;
      if (q && !l.description.toLowerCase().includes(q) && !l.transaction_date.includes(q)) return false;
      return true;
    });
  }, [data?.lines, filterUnmatchedOnly, filterPartialOnly, filterAgeOver30, filterDuplicatesOnly, searchQuery]);

  const visibleBulkSelected = useMemo(() => {
    const vis = new Set(filteredLines.map((l) => l.id));
    return [...bulkSelectedIds].filter((id) => vis.has(id));
  }, [bulkSelectedIds, filteredLines]);

  const onSelectBankLine = (id: string) => {
    setSelectedBankLineId(id);
    const sug = suggestMap.get(id);
    if (sug?.ledgerLineIds?.length) {
      setSelectedLedgerIds(new Set(sug.ledgerLineIds));
    } else {
      setSelectedLedgerIds(new Set());
    }
  };

  const toggleLedger = (id: string) => {
    setSelectedLedgerIds((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  const toggleBulkRow = (id: string) => {
    setBulkSelectedIds((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  const selectAllVisible = () => {
    if (isCompleted) return;
    const ids = filteredLines.map((l) => l.id);
    const allOn = ids.length > 0 && ids.every((id) => bulkSelectedIds.has(id));
    if (allOn) {
      setBulkSelectedIds((prev) => {
        const n = new Set(prev);
        for (const id of ids) n.delete(id);
        return n;
      });
    } else {
      setBulkSelectedIds((prev) => {
        const n = new Set(prev);
        for (const id of ids) n.add(id);
        return n;
      });
    }
  };

  const toggleExpanded = (id: string) => {
    setExpandedBankLineIds((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  const loadAccountsForEntry = async () => {
    if (!business?.id || !user?.id) return;
    const res = await fetch(
      `/api/accounts?business_id=${encodeURIComponent(business.id)}&is_active=true&user_id=${encodeURIComponent(user.id)}`
    );
    const j = await res.json();
    if (!res.ok || !Array.isArray(j.accounts)) return;
    const exp = j.accounts.filter((a: { account_type: string }) => a.account_type === 'expense');
    const inc = j.accounts.filter((a: { account_type: string }) => a.account_type === 'income');
    setExpenseAccounts(exp.map((a: { id: string; account_name: string; account_code: string }) => a));
    setIncomeAccounts(inc.map((a: { id: string; account_name: string; account_code: string }) => a));
  };

  const openCreateEntry = () => {
    setShowCreateEntry(true);
    setEntryAccountId('');
    void loadAccountsForEntry();
  };

  const postAction = async (url: string, body: object): Promise<boolean> => {
    if (!business?.id || !user?.id || !statementId) return false;
    setActing(true);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...body,
          business_id: business.id,
          created_by_user_id: user.id,
          bank_statement_id: statementId,
        }),
      });
      const j = await res.json();
      if (!res.ok) {
        toast.error(j.error || 'Action failed');
        return false;
      }
      if (j.matched_count !== undefined) {
        toast.success(`Auto-matched ${j.matched_count}, skipped ${j.skipped_count ?? 0}`);
      } else if (j.voucher_number) {
        toast.success(`Posted journal ${j.voucher_number}`);
      } else {
        toast.success('Updated');
      }
      await loadRec();
      setSelectedLedgerIds(new Set());
      return true;
    } catch {
      toast.error('Network error');
      return false;
    } finally {
      setActing(false);
    }
  };

  const runBulkMatch = async () => {
    if (!business?.id || !user?.id || !statementId || isCompleted) return;
    const ids = visibleBulkSelected;
    if (!ids.length) {
      toast.error('Select at least one bank line');
      return;
    }
    setActing(true);
    let matched = 0;
    let skipped = 0;
    try {
      for (const lineId of ids) {
        const sug = suggestMap.get(lineId);
        if (!sug?.ledgerLineIds?.length) {
          skipped++;
          continue;
        }
        const res = await fetch('/api/bank/reconciliation/match', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            business_id: business.id,
            created_by_user_id: user.id,
            bank_statement_id: statementId,
            statement_line_id: lineId,
            ledger_line_ids: sug.ledgerLineIds,
          }),
        });
        const j = await res.json();
        if (!res.ok) {
          toast.error(j.error || `Match failed for a row`);
          break;
        }
        matched++;
      }
      if (matched || skipped) {
        toast.success(`Bulk match: ${matched} posted, ${skipped} skipped (no suggestion)`);
      }
      await loadRec();
      setBulkSelectedIds(new Set());
      setSelectedLedgerIds(new Set());
    } catch {
      toast.error('Network error');
    } finally {
      setActing(false);
    }
  };

  const runBulkIgnore = async () => {
    if (!business?.id || !user?.id || !statementId || isCompleted) return;
    const ids = visibleBulkSelected;
    if (!ids.length) {
      toast.error('Select at least one bank line');
      return;
    }
    setActing(true);
    let n = 0;
    try {
      for (const lineId of ids) {
        const res = await fetch('/api/bank/reconciliation/ignore', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            business_id: business.id,
            created_by_user_id: user.id,
            bank_statement_id: statementId,
            statement_line_id: lineId,
          }),
        });
        const j = await res.json();
        if (!res.ok) {
          toast.error(j.error || 'Ignore failed');
          break;
        }
        n++;
      }
      if (n) toast.success(`Ignored ${n} line(s)`);
      await loadRec();
      setBulkSelectedIds(new Set());
    } catch {
      toast.error('Network error');
    } finally {
      setActing(false);
    }
  };

  const rowClass = (st: string) => {
    if (st === 'ignored') return 'bg-gray-100/90 border-l-4 border-l-gray-500';
    if (st === 'partial')
      return 'bg-emerald-50/90 border-l-4 border-l-emerald-600 ring-1 ring-inset ring-emerald-200/60';
    if (st === 'matched') return 'bg-green-50 border-l-4 border-l-green-600';
    return 'bg-white border-l-4 border-l-red-500 ring-1 ring-inset ring-red-100';
  };

  const ageBadgeClass = (days: number | undefined) => {
    if (days == null || days <= 30) return 'bg-gray-100 text-gray-700';
    if (days <= 60) return 'bg-amber-100 text-amber-900';
    return 'bg-red-100 text-red-900';
  };

  const markComplete = async () => {
    if (!business?.id || !user?.id || !statementId || !data) return;
    let force = false;
    if (data.summary.unmatched_count > 0) {
      if (
        !window.confirm(
          `There are ${data.summary.unmatched_count} unmatched line(s). Mark this statement as reconciled anyway?`
        )
      ) {
        return;
      }
      force = true;
    }
    setActing(true);
    try {
      const res = await fetch('/api/bank/reconciliation/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: business.id,
          created_by_user_id: user.id,
          bank_statement_id: statementId,
          force,
        }),
      });
      const j = await res.json();
      if (!res.ok) {
        toast.error(j.error || 'Could not complete');
        return;
      }
      toast.success('Marked as reconciled');
      await loadRec();
    } catch {
      toast.error('Network error');
    } finally {
      setActing(false);
    }
  };

  const submitCreateEntry = async () => {
    if (!selectedBankLineId || !entryAccountId) {
      toast.error('Select a bank line and account');
      return;
    }
    const ok = await postAction('/api/bank/reconciliation/create-entry', {
      statement_line_id: selectedBankLineId,
      type: entryType,
      account_id: entryAccountId,
    });
    if (ok) setShowCreateEntry(false);
  };

  const allVisibleSelected =
    filteredLines.length > 0 && filteredLines.every((l) => bulkSelectedIds.has(l.id));
  const someVisibleSelected =
    filteredLines.some((l) => bulkSelectedIds.has(l.id)) && !allVisibleSelected;

  useEffect(() => {
    const el = selectAllRef.current;
    if (el) el.indeterminate = someVisibleSelected;
  }, [someVisibleSelected]);

  const selectedLineRow =
    data && selectedBankLineId ? data.lines.find((x) => x.id === selectedBankLineId) : undefined;
  const selectedLineSuggestion =
    selectedLineRow && selectedBankLineId ? suggestMap.get(selectedBankLineId) : undefined;

  if (!business) {
    return (
      <div className="flex min-h-[240px] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary-600 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1600px] space-y-4 px-4 py-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Bank reconciliation</h1>
          <p className="mt-1 text-sm text-text-secondary">
            Match statement lines to ledger entries. Use filters and bulk actions for large statements. Notes are stored
            in this browser only.
          </p>
        </div>
        <Link href="/bank/import" className="text-sm text-primary-600 hover:underline">
          ← Import statement
        </Link>
      </header>

      <div className="flex flex-wrap gap-3 rounded-xl border border-border bg-white p-4 shadow-sm">
        <label className="text-sm">
          <span className="font-medium text-text-secondary">Bank account</span>
          <select
            className="mt-1 block rounded-md border border-border px-3 py-2 text-sm"
            value={bankAccountId}
            onChange={(e) => {
              setBankAccountId(e.target.value);
              setStatementId(null);
              setData(null);
            }}
          >
            <option value="">Select…</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.bank_name} — {a.account_name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="font-medium text-text-secondary">Statement</span>
          <select
            className="mt-1 block min-w-[200px] rounded-md border border-border px-3 py-2 text-sm"
            value={statementId ?? ''}
            onChange={(e) => setStatementId(e.target.value || null)}
            disabled={!statements.length}
          >
            <option value="">Select…</option>
            {statements.map((s) => (
              <option key={s.id} value={s.id}>
                {s.statement_period_start} → {s.statement_period_end}
                {s.reconciliation_status === 'completed' ? ' (done)' : ''}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="self-end rounded-md border border-border px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
          onClick={() => loadRec()}
          disabled={busy || !statementId}
        >
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {statementId && loading && !data ? (
        <div className="rounded-xl border border-border bg-white p-6 shadow-sm">
          <p className="mb-3 text-sm font-medium text-text-secondary">Loading reconciliation…</p>
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-10 animate-pulse rounded-md bg-gray-100" />
            ))}
          </div>
        </div>
      ) : null}

      {data && (
        <div className="sticky top-0 z-40 space-y-3 border-b border-border bg-background/98 pb-3 pt-1 shadow-sm backdrop-blur-md">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={busy || isCompleted}
                  className="rounded-md bg-primary-600 px-3 py-2 text-xs font-medium text-white disabled:opacity-50"
                  onClick={() => void postAction('/api/bank/reconciliation/auto-match', {})}
                >
                  Auto-match (high confidence)
                </button>
                <button
                  type="button"
                  disabled={busy || isCompleted}
                  className="rounded-md border border-border bg-white px-3 py-2 text-xs font-medium text-text-primary disabled:opacity-50"
                  onClick={openCreateEntry}
                >
                  Create entry…
                </button>
                <button
                  type="button"
                  disabled={busy || isCompleted}
                  className="rounded-md border border-green-800 bg-green-50 px-3 py-2 text-xs font-medium text-green-900 disabled:opacity-50"
                  onClick={() => void markComplete()}
                >
                  Mark as reconciled
                </button>
                <button
                  type="button"
                  disabled={busy || isCompleted || visibleBulkSelected.length === 0}
                  className="rounded-md border border-green-700 bg-white px-3 py-2 text-xs font-medium text-green-900 disabled:opacity-50"
                  onClick={() => void runBulkMatch()}
                >
                  Match selected ({visibleBulkSelected.length})
                </button>
                <button
                  type="button"
                  disabled={busy || isCompleted || visibleBulkSelected.length === 0}
                  className="rounded-md border border-border bg-white px-3 py-2 text-xs font-medium disabled:opacity-50"
                  onClick={() => void runBulkIgnore()}
                >
                  Ignore selected ({visibleBulkSelected.length})
                </button>
                {isCompleted ? (
                  <span className="rounded-full bg-green-100 px-2 py-1 text-xs font-medium text-green-800">
                    Status: completed
                  </span>
                ) : (
                  <span className="text-xs text-text-muted">Status: in progress</span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="relative flex items-center rounded-md border border-border bg-white">
                  <Search className="pointer-events-none absolute left-2 h-3.5 w-3.5 text-text-muted" />
                  <input
                    type="search"
                    placeholder="Search description / date…"
                    className="w-48 min-w-[8rem] rounded-md border-0 bg-transparent py-1.5 pl-7 pr-2 text-xs focus:ring-0 sm:w-56"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </span>
                <label className="flex cursor-pointer items-center gap-1 rounded-md border border-border bg-white px-2 py-1">
                  <input
                    type="checkbox"
                    checked={filterUnmatchedOnly}
                    onChange={(e) => setFilterUnmatchedOnly(e.target.checked)}
                    className="rounded border-border"
                  />
                  Unmatched only
                </label>
                <label className="flex cursor-pointer items-center gap-1 rounded-md border border-border bg-white px-2 py-1">
                  <input
                    type="checkbox"
                    checked={filterPartialOnly}
                    onChange={(e) => setFilterPartialOnly(e.target.checked)}
                    className="rounded border-border"
                  />
                  Partial matches
                </label>
                <label className="flex cursor-pointer items-center gap-1 rounded-md border border-border bg-white px-2 py-1">
                  <input
                    type="checkbox"
                    checked={filterAgeOver30}
                    onChange={(e) => setFilterAgeOver30(e.target.checked)}
                    className="rounded border-border"
                  />
                  Age &gt; 30d
                </label>
                <label className="flex cursor-pointer items-center gap-1 rounded-md border border-border bg-white px-2 py-1">
                  <input
                    type="checkbox"
                    checked={filterDuplicatesOnly}
                    onChange={(e) => setFilterDuplicatesOnly(e.target.checked)}
                    className="rounded border-border"
                  />
                  Duplicates
                </label>
              </div>
              <label className="block text-xs text-text-secondary">
                <span className="font-medium text-text-primary">Reconciliation note (optional, this device only)</span>
                <textarea
                  className="mt-1 w-full max-w-xl rounded-md border border-border bg-white px-2 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary-500/30"
                  rows={2}
                  placeholder="e.g. Pending 2 UTRs from vendor…"
                  value={recNote}
                  onChange={(e) => setRecNote(e.target.value)}
                  disabled={!statementId}
                />
              </label>
            </div>

            <div className="grid w-full shrink-0 grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:w-auto xl:max-w-[720px]">
              <div className="rounded-lg border border-border bg-white px-3 py-2 text-xs shadow-sm">
                <p className="text-text-muted">Opening</p>
                <p className="font-semibold tabular-nums">₹{fmt(data.summary.opening_balance)}</p>
              </div>
              <div className="rounded-lg border border-border bg-white px-3 py-2 text-xs shadow-sm">
                <p className="text-text-muted">Closing (statement)</p>
                <p className="font-semibold tabular-nums">₹{fmt(data.summary.closing_balance)}</p>
              </div>
              <div className="rounded-lg border border-border bg-white px-3 py-2 text-xs shadow-sm">
                <p className="text-text-muted">Book balance</p>
                <p className="font-semibold tabular-nums">₹{fmt(data.summary.ledger_book_balance ?? 0)}</p>
              </div>
              <div
                className={`rounded-lg border px-3 py-2 text-xs shadow-sm ${
                  Math.abs(data.summary.reconciliation_difference ?? 0) < 0.01
                    ? 'border-green-300 bg-green-50'
                    : 'border-red-300 bg-red-50'
                }`}
              >
                <p className="text-text-muted">Reconciliation difference</p>
                <p
                  className={`font-semibold tabular-nums ${
                    Math.abs(data.summary.reconciliation_difference ?? 0) < 0.01 ? 'text-green-800' : 'text-red-800'
                  }`}
                >
                  ₹{fmt(data.summary.reconciliation_difference ?? 0)}
                </p>
              </div>
              <div className="rounded-lg border border-border bg-white px-3 py-2 text-xs shadow-sm">
                <p className="text-text-muted">Closing − opening</p>
                <p className="font-semibold tabular-nums">₹{fmt(data.summary.difference)}</p>
              </div>
              <div className="rounded-lg border border-border bg-white px-3 py-2 text-xs shadow-sm">
                <p className="text-text-muted">Matched / Unmatched</p>
                <p className="font-semibold">
                  <span className="text-green-700">{data.summary.matched_count}</span>
                  <span className="text-text-muted"> / </span>
                  <span className="text-red-700">{data.summary.unmatched_count}</span>
                </p>
              </div>
              <div className="rounded-lg border border-border bg-white px-3 py-2 text-xs shadow-sm">
                <p className="text-text-muted">Ignored · Lines · Showing</p>
                <p className="font-semibold text-gray-700">
                  {data.summary.ignored_count} · {data.summary.total_lines} · {filteredLines.length}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {data && (
        <div
          className={`grid grid-cols-1 gap-4 lg:grid-cols-2 ${loading ? 'pointer-events-none opacity-60' : ''}`}
        >
          <section className="rounded-xl border border-border bg-white shadow-sm">
            <h2 className="border-b border-border px-3 py-2 text-sm font-semibold">
              Bank lines
              {loading ? (
                <span className="ml-2 text-xs font-normal text-text-muted">Refreshing…</span>
              ) : null}
            </h2>
            <div className="max-h-[70vh] overflow-auto">
              <table className="min-w-full text-left text-xs">
                <thead className="sticky top-0 z-10 bg-gray-50 text-text-secondary shadow-sm">
                  <tr>
                    <th className="w-8 px-1 py-2">
                      <input
                        ref={selectAllRef}
                        type="checkbox"
                        title="Select all visible"
                        checked={allVisibleSelected && filteredLines.length > 0}
                        disabled={isCompleted || loading || filteredLines.length === 0}
                        onChange={selectAllVisible}
                        aria-label="Select all visible bank lines"
                        className="rounded border-border"
                      />
                    </th>
                    <th className="w-8 px-0 py-2" />
                    <th className="px-2 py-2">Date</th>
                    <th className="px-2 py-2">Description</th>
                    <th className="px-2 py-2 text-right">Dr</th>
                    <th className="px-2 py-2 text-right">Cr</th>
                    <th className="w-8 px-1 py-2" title="Warnings" />
                  </tr>
                </thead>
                <tbody>
                  {filteredLines.map((l) => {
                      const sug = suggestMap.get(l.id);
                      const isPartial = l.match_status === 'partial';
                      const multiMatch = (l.matched_ledger_ids?.length ?? 0) > 1;
                      const showBreakdown = isPartial || multiMatch;
                      const expanded = expandedBankLineIds.has(l.id);
                      const flow = bankLineFlow(l);
                      const breakdown =
                        showBreakdown && l.matched_ledger_ids?.length
                          ? partialBreakdownRows(l.matched_ledger_ids, ledgerById)
                          : [];

                      return (
                        <React.Fragment key={l.id}>
                          <tr
                            className={`cursor-pointer border-t border-border hover:bg-black/[0.02] ${rowClass(l.match_status)} ${
                              selectedBankLineId === l.id ? 'ring-2 ring-inset ring-primary-500' : ''
                            }`}
                            onClick={() => onSelectBankLine(l.id)}
                          >
                            <td
                              className="px-1 py-1 align-middle"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <input
                                type="checkbox"
                                checked={bulkSelectedIds.has(l.id)}
                                disabled={isCompleted}
                                onChange={() => toggleBulkRow(l.id)}
                                aria-label={`Select row ${l.transaction_date}`}
                                className="rounded border-border"
                              />
                            </td>
                            <td className="px-0 py-1 align-middle" onClick={(e) => e.stopPropagation()}>
                              {showBreakdown ? (
                                <button
                                  type="button"
                                  className="rounded p-0.5 text-text-muted hover:bg-gray-200/80"
                                  onClick={() => toggleExpanded(l.id)}
                                  aria-expanded={expanded}
                                  aria-label={expanded ? 'Collapse split match' : 'Expand split match'}
                                >
                                  {expanded ? (
                                    <ChevronDown className="h-4 w-4" />
                                  ) : (
                                    <ChevronRight className="h-4 w-4" />
                                  )}
                                </button>
                              ) : (
                                <span className="inline-block w-5" />
                              )}
                            </td>
                            <td className="px-2 py-1 align-top font-mono">
                              <div className="flex flex-wrap items-center gap-1">
                                {l.transaction_date}
                                {l.match_status === 'unmatched' && l.age_days != null && l.age_days > 0 ? (
                                  <span
                                    className={`rounded px-1 py-0 text-[10px] font-medium ${ageBadgeClass(l.age_days)}`}
                                    title={`${l.age_days} days since transaction`}
                                  >
                                    {l.age_days}d
                                  </span>
                                ) : null}
                              </div>
                            </td>
                            <td className="px-2 py-1 align-top text-text-primary">
                              <div className="flex flex-col gap-1">
                                <span>{l.description}</span>
                                {l.match_status === 'unmatched' && sug ? (
                                  <div className="flex flex-wrap items-center gap-1">
                                    <span
                                      className={`inline-flex max-w-full cursor-help rounded border px-1.5 py-0 text-[10px] font-medium ${tierBadgeClass(sug.tier)}`}
                                      title={matchReasonTooltipText(sug, l, ledgerById)}
                                    >
                                      {suggestionHeadline(sug, l, ledgerById, fmt)}
                                    </span>
                                    <span className="text-[10px] text-text-muted">({sug.confidence})</span>
                                  </div>
                                ) : null}
                              </div>
                            </td>
                            <td className="px-2 py-1 text-right tabular-nums align-top">{fmt(l.debit_amount)}</td>
                            <td className="px-2 py-1 text-right tabular-nums align-top">{fmt(l.credit_amount)}</td>
                            <td className="px-1 py-1 text-center align-top">
                              {l.is_duplicate ? (
                                <span title="Possible duplicate transaction (same date, amount, similar description)">
                                  <AlertTriangle
                                    className="inline h-4 w-4 text-amber-600"
                                    aria-label="Duplicate warning"
                                  />
                                </span>
                              ) : null}
                            </td>
                          </tr>
                          {expanded && showBreakdown && breakdown.length ? (
                            <tr className="bg-gray-50/95 border-t border-dashed border-border">
                              <td colSpan={7} className="px-4 py-2 text-[11px] text-text-secondary">
                                <p className="font-medium text-text-primary">
                                  ₹{fmt(flow.amount)} matched with:
                                </p>
                                <ul className="mt-1 list-inside list-disc space-y-0.5">
                                  {breakdown.map((row) => (
                                    <li key={row.id}>
                                      ₹{fmt(row.amount)} ({row.label})
                                    </li>
                                  ))}
                                </ul>
                              </td>
                            </tr>
                          ) : null}
                        </React.Fragment>
                      );
                  })}
                </tbody>
              </table>
            </div>
            {!loading && data && filteredLines.length === 0 && data.lines.length > 0 ? (
              <p className="border-t border-border px-3 py-4 text-center text-sm text-text-secondary">
                No lines match your filters — adjust search or filters above.
              </p>
            ) : null}
            {!loading && data && data.summary.unmatched_count === 0 && data.summary.total_lines > 0 ? (
              <p className="border-t border-border px-3 py-3 text-center text-sm font-medium text-green-800">
                {'\u2705'} All transactions are reconciled
              </p>
            ) : null}
            {!loading && data && data.lines.length === 0 ? (
              <p className="border-t border-border px-3 py-6 text-center text-sm text-text-secondary">
                No statement lines loaded for this import.
              </p>
            ) : null}
          </section>

          <section className="rounded-xl border border-border bg-white shadow-sm">
            <h2 className="border-b border-border px-3 py-2 text-sm font-semibold">Ledger (bank account)</h2>
            <div className="max-h-[70vh] overflow-auto">
              <table className="min-w-full text-left text-xs">
                <thead className="sticky top-0 z-10 bg-gray-50 text-text-secondary shadow-sm">
                  <tr>
                    <th className="px-1 py-2 w-8" />
                    <th className="px-2 py-2">Date</th>
                    <th className="px-2 py-2">Narration</th>
                    <th className="px-2 py-2 text-right">Dr</th>
                    <th className="px-2 py-2 text-right">Cr</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.ledger_lines.map((l) => {
                    const sug = selectedBankLineId ? suggestMap.get(selectedBankLineId) : null;
                    const hinted = sug?.ledgerLineIds.includes(l.id);
                    return (
                      <tr
                        key={l.id}
                        className={`border-t border-border ${hinted ? 'bg-amber-50/80' : ''} ${
                          selectedLedgerIds.has(l.id) ? 'ring-1 ring-inset ring-gray-400' : ''
                        }`}
                      >
                        <td className="px-1 py-1 text-center">
                          <input
                            type="checkbox"
                            checked={selectedLedgerIds.has(l.id)}
                            onChange={() => toggleLedger(l.id)}
                            aria-label="Select ledger line"
                            disabled={busy}
                          />
                        </td>
                        <td className="px-2 py-1 font-mono">{l.entry_date}</td>
                        <td className="px-2 py-1 text-text-primary">
                          {(l.narration || '').slice(0, 120)}
                          {l.reference_number ? (
                            <span className="ml-1 text-text-muted">#{l.reference_number}</span>
                          ) : null}
                        </td>
                        <td className="px-2 py-1 text-right tabular-nums">{fmt(l.debit)}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{fmt(l.credit)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      {data && selectedBankLineId && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-gray-50 px-4 py-3 text-sm">
          <span className="text-text-secondary">Selected bank line</span>
          <span className="font-mono text-xs">{selectedBankLineId}</span>
          {selectedLineSuggestion && selectedLineRow ? (
            <span
              className={`max-w-full cursor-help rounded border px-2 py-0.5 text-xs ${tierBadgeClass(selectedLineSuggestion.tier)}`}
              title={matchReasonTooltipText(selectedLineSuggestion, selectedLineRow, ledgerById)}
            >
              {`${suggestionHeadline(selectedLineSuggestion, selectedLineRow, ledgerById, fmt)} (${selectedLineSuggestion.confidence})`}
            </span>
          ) : null}
          <button
            type="button"
            disabled={acting || selectedLedgerIds.size === 0 || isCompleted}
            className="rounded-md border border-green-700 bg-green-50 px-3 py-1.5 text-xs font-medium text-green-900 disabled:opacity-50"
            onClick={() =>
              void postAction('/api/bank/reconciliation/match', {
                statement_line_id: selectedBankLineId,
                ledger_line_ids: Array.from(selectedLedgerIds),
              })
            }
          >
            Match selected
          </button>
          <button
            type="button"
            disabled={acting || isCompleted}
            className="rounded-md border border-border bg-white px-3 py-1.5 text-xs disabled:opacity-50"
            onClick={() =>
              void postAction('/api/bank/reconciliation/ignore', { statement_line_id: selectedBankLineId })
            }
          >
            Ignore
          </button>
          <button
            type="button"
            disabled={acting}
            className="rounded-md border border-border bg-white px-3 py-1.5 text-xs disabled:opacity-50"
            onClick={() =>
              void postAction('/api/bank/reconciliation/undo', { statement_line_id: selectedBankLineId })
            }
          >
            Undo
          </button>
          {!isCompleted ? (
            <button
              type="button"
              disabled={acting}
              className="rounded-md border border-border bg-white px-3 py-1.5 text-xs disabled:opacity-50"
              onClick={openCreateEntry}
            >
              Create entry
            </button>
          ) : null}
        </div>
      )}

      {showCreateEntry && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md rounded-xl border border-border bg-white p-4 shadow-lg">
            <h3 className="text-sm font-semibold text-text-primary">Post missing ledger entry</h3>
            <p className="mt-1 text-xs text-text-secondary">
              Bank charge: Dr expense · Cr bank. Interest: Dr bank · Cr income. The bank line will be matched to the
              new bank leg.
            </p>
            <label className="mt-3 block text-xs font-medium text-text-secondary">
              Type
              <select
                className="mt-1 w-full rounded-md border border-border px-2 py-1.5 text-sm"
                value={entryType}
                onChange={(e) => setEntryType(e.target.value === 'interest' ? 'interest' : 'bank_charge')}
                disabled={acting}
              >
                <option value="bank_charge">Bank charge (statement debit)</option>
                <option value="interest">Interest (statement credit)</option>
              </select>
            </label>
            <label className="mt-3 block text-xs font-medium text-text-secondary">
              Offset account
              <select
                className="mt-1 w-full rounded-md border border-border px-2 py-1.5 text-sm"
                value={entryAccountId}
                onChange={(e) => setEntryAccountId(e.target.value)}
                disabled={acting}
              >
                <option value="">Select account…</option>
                {(entryType === 'bank_charge' ? expenseAccounts : incomeAccounts).map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.account_code} — {a.account_name}
                  </option>
                ))}
              </select>
            </label>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className="rounded-md border border-border px-3 py-1.5 text-xs"
                onClick={() => setShowCreateEntry(false)}
                disabled={acting}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={acting || !entryAccountId}
                className="rounded-md bg-primary-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                onClick={() => void submitCreateEntry()}
              >
                Post &amp; match
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function BankReconciliationPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[240px] items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary-600 border-t-transparent" />
        </div>
      }
    >
      <BankReconciliationPageContent />
    </Suspense>
  );
}
