'use client';

export const dynamic = 'force-dynamic';

import React, { useState, useEffect, useMemo } from 'react';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Loader2, ChevronRight, ChevronDown } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { buildApiUrl } from '@/lib/api-helpers';
import { format } from 'date-fns';
import { withPageAuth } from '@/lib/auth/withPageAuth';
import { AccessDenied } from '@/components/common/AccessDenied';
import { MobileReportHeader } from '@/components/layout/MobileReportHeader';
import { ProfitLossDrilldownPanel, type DrillTarget } from '@/components/reports/ProfitLossDrilldownPanel';
// Types only: that module imports server-side database code.
import type { PlComparison, CompareRow, CompareSection } from '@/lib/reports/profit-loss-compare';
import { changeBetween, isReportDate, periodLabel, type CompareMode } from '@/lib/reports/pl-compare-periods';

interface CompareResponse extends PlComparison {
  branch: { id: string; name: string } | null;
  is_consolidated: boolean;
  compare: CompareMode;
}

const inr = (n: number) =>
  `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const isNil = (n: number | null | undefined) => n == null || Math.abs(n) < 0.005;

const REQUEST_DELAY_MS = 400;

/** The value as it was once it has stopped changing for `delayMs`; each change restarts the wait. */
function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

interface CompareRequest {
  fromDate: string;
  toDate: string;
  mode: CompareMode;
  count: string;
  customFrom: string;
  customTo: string;
  includeZero: boolean;
  /** Every date is complete, so the request may be sent. */
  ready: boolean;
}

const subtreeIds = (r: CompareRow): string[] => [r.id, ...r.children.flatMap(subtreeIds)];

const accountTarget = (r: CompareRow, section: string): DrillTarget => ({
  kind: 'account',
  label: `${r.account_code} ${r.account_name}`,
  accountIds: [r.id],
  section,
});

const subtreeTarget = (r: CompareRow, section: string): DrillTarget => ({
  kind: 'account',
  label: r.account_name,
  accountIds: subtreeIds(r),
  section,
});

function Amount({ value, testId }: { value?: number | null; testId?: string }) {
  if (value == null || isNil(value)) {
    return (
      <span className="tabular-nums text-text-secondary" data-testid={testId} data-value={value ?? 0}>
        –
      </span>
    );
  }
  return (
    <span className={`tabular-nums ${value < 0 ? 'text-red-600' : ''}`} data-testid={testId} data-value={value}>
      {inr(value)}
    </span>
  );
}

const cellLabel = 'py-2 pr-3 text-left align-top';
const cellAmount = 'py-2 pl-3 text-right align-top whitespace-nowrap';

/** Change (₹) and Change (%) of the first column against the second. Only drawn when exactly two columns show. */
function ChangeCells({
  values,
  amountTestId,
  percentTestId,
}: {
  values: number[];
  amountTestId?: string;
  percentTestId?: string;
}) {
  if (values.length !== 2) return null;
  const change = changeBetween(values[0], values[1]);
  // A nil change shows `–` in both cells, never `0.0%`.
  const percent = isNil(change.amount) ? null : change.percent;
  return (
    <>
      <td className={cellAmount}>
        <Amount value={change.amount} testId={amountTestId} />
      </td>
      <td className={cellAmount}>
        {percent == null ? (
          <span className="tabular-nums text-text-secondary" data-testid={percentTestId}>
            –
          </span>
        ) : (
          <span
            className={`tabular-nums ${percent < 0 ? 'text-red-600' : ''}`}
            data-testid={percentTestId}
            data-value={percent}
          >
            {`${percent.toFixed(1)}%`}
          </span>
        )}
      </td>
    </>
  );
}

/** One row of figures: a label, one amount per column, then the change cells when two columns show. */
function FigureRow({
  label,
  values,
  onDrill,
  testId,
  changeTestIds,
  className = '',
}: {
  label: React.ReactNode;
  values: number[];
  /** Opens the drill-down for that column; nil amounts are never clickable. */
  onDrill?: (col: number) => void;
  testId?: (col: number) => string;
  changeTestIds?: { amount: string; percent: string };
  className?: string;
}) {
  return (
    <tr className={`border-b border-border/60 ${className}`}>
      <td className={cellLabel}>{label}</td>
      {values.map((v, i) => (
        <td key={i} className={cellAmount}>
          {onDrill && !isNil(v) ? (
            <button
              type="button"
              title="Click to see what makes up this amount"
              onClick={() => onDrill(i)}
              className="hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
            >
              <Amount value={v} testId={testId?.(i)} />
            </button>
          ) : (
            <Amount value={v} testId={testId?.(i)} />
          )}
        </td>
      ))}
      <ChangeCells values={values} amountTestId={changeTestIds?.amount} percentTestId={changeTestIds?.percent} />
    </tr>
  );
}

function AccountRows({
  rows,
  section,
  depth,
  hideSubAccounts,
  onDrill,
}: {
  rows: CompareRow[];
  section: string;
  depth: number;
  hideSubAccounts: boolean;
  onDrill: (target: DrillTarget, col: number) => void;
}) {
  return (
    <>
      {rows.map((r) => {
        const hasChildren = r.children.length > 0;
        const rolledUp = hideSubAccounts && hasChildren;
        const target = rolledUp ? subtreeTarget(r, section) : accountTarget(r, section);
        return (
          <React.Fragment key={r.id}>
            <FigureRow
              label={
                <span className="flex items-center gap-2 min-w-0" style={{ paddingLeft: 16 + depth * 20 }}>
                  <span className="font-mono text-xs text-text-secondary">{r.account_code}</span>
                  <span>{r.account_name}</span>
                  {!r.is_active && (
                    <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-700 text-[10px] uppercase tracking-wide">
                      Inactive
                    </span>
                  )}
                </span>
              }
              values={rolledUp ? r.totals : r.amounts}
              onDrill={(col) => onDrill(target, col)}
            />
            {hasChildren && !rolledUp && (
              <>
                <AccountRows
                  rows={r.children}
                  section={section}
                  depth={depth + 1}
                  hideSubAccounts={hideSubAccounts}
                  onDrill={onDrill}
                />
                <FigureRow
                  label={<span style={{ paddingLeft: 16 + depth * 20 }}>Total for {r.account_name}</span>}
                  values={r.totals}
                  onDrill={(col) => onDrill(subtreeTarget(r, section), col)}
                  className="font-medium"
                />
              </>
            )}
          </React.Fragment>
        );
      })}
    </>
  );
}

function SectionRows({
  section,
  colSpan,
  collapsed,
  onToggle,
  hideSubAccounts,
  onDrill,
}: {
  section: CompareSection;
  colSpan: number;
  collapsed: boolean;
  onToggle: () => void;
  hideSubAccounts: boolean;
  onDrill: (target: DrillTarget, col: number) => void;
}) {
  const stock = section.key === 'cost_of_goods_sold' ? section.stock : null;
  return (
    <>
      <tr>
        <td colSpan={colSpan} className="pt-5 pb-2">
          <button
            type="button"
            onClick={onToggle}
            className="flex items-center gap-1 text-left font-semibold text-text-primary"
            aria-expanded={!collapsed}
          >
            {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            {section.label}
          </button>
        </td>
      </tr>
      {!collapsed && (
        <>
          {stock && (
            <>
              <FigureRow
                label={<span className="pl-4">Opening Stock</span>}
                values={stock.opening_stock}
                onDrill={(col) => onDrill({ kind: 'opening_stock', label: 'Opening Stock' }, col)}
              />
              <FigureRow
                label={<span className="pl-4">Add: Purchases (net of returns)</span>}
                values={stock.purchases}
                onDrill={(col) => onDrill({ kind: 'purchases', label: 'Purchases' }, col)}
              />
              <FigureRow
                label={<span className="pl-4">Less: Closing Stock</span>}
                values={stock.closing_stock.map((v) => -v)}
                onDrill={(col) => onDrill({ kind: 'closing_stock', label: 'Closing Stock' }, col)}
              />
            </>
          )}
          <AccountRows
            rows={section.rows}
            section={section.key}
            depth={0}
            hideSubAccounts={hideSubAccounts}
            onDrill={onDrill}
          />
        </>
      )}
      <FigureRow
        label={<span className="pl-4">Total for {section.label}</span>}
        values={section.totals}
        testId={(i) => `plc-section-total-${section.key}-${i}`}
        className="border-t border-border font-semibold"
      />
    </>
  );
}

function ProfitRow({
  label,
  values,
  testKey,
  final = false,
  changeTestIds,
}: {
  label: string;
  values: number[];
  testKey?: string;
  final?: boolean;
  changeTestIds?: { amount: string; percent: string };
}) {
  return (
    <FigureRow
      label={<span className="pl-4">{label}</span>}
      values={values}
      testId={testKey ? (i) => `plc-profit-${testKey}-${i}` : undefined}
      changeTestIds={changeTestIds}
      className={`font-bold ${final ? 'border-t-2 border-border bg-gray-100' : 'bg-slate-50'}`}
    />
  );
}

function ProfitLossComparePage() {
  const { business, user } = useAuth();
  const [drill, setDrill] = useState<{ target: DrillTarget; col: number } | null>(null);
  const [data, setData] = useState<CompareResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ message: string; code?: string } | null>(null);
  const [badRequest, setBadRequest] = useState<string | null>(null);
  /** Any failure other than no access (401/403) or bad input (400): shown in place of the table. */
  const [failure, setFailure] = useState<string | null>(null);
  const [includeZero, setIncludeZero] = useState(false);
  const [hideSubAccounts, setHideSubAccounts] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  // Opens on the same period last year: with the default dates (financial year to date) the previous
  // equal-length period would straddle a year end.
  const [mode, setMode] = useState<CompareMode>('previous_year');
  const [count, setCount] = useState('1');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [fromDate, setFromDate] = useState(() => {
    const now = new Date();
    const currentYear = now.getFullYear();
    const fyStart = new Date(currentYear, 3, 1);
    return now < fyStart ? format(new Date(currentYear - 1, 3, 1), 'yyyy-MM-dd') : format(fyStart, 'yyyy-MM-dd');
  });
  const [toDate, setToDate] = useState(format(new Date(), 'yyyy-MM-dd'));

  const isCustom = mode === 'custom';
  const customIncomplete = isCustom && (!customFrom || !customTo);
  // Custom dates are kept while another choice is made, but only sent (and only refetch) for Custom.
  const countParam = isCustom ? '' : count;
  const customFromParam = isCustom ? customFrom : '';
  const customToParam = isCustom ? customTo : '';
  // A date field reports every keystroke of a typed year (2026 passes through 0202), so nothing is
  // sent until each date is a real date in or after 1900. An empty custom date has its own message.
  const filledCustomBad = isCustom && [customFrom, customTo].some((v) => v !== '' && !isReportDate(v));
  const datesIncomplete = !isReportDate(fromDate) || !isReportDate(toDate) || filledCustomBad;

  const request = useMemo<CompareRequest>(
    () => ({
      fromDate,
      toDate,
      mode,
      count: countParam,
      customFrom: customFromParam,
      customTo: customToParam,
      includeZero,
      ready: !customIncomplete && !datesIncomplete,
    }),
    [fromDate, toDate, mode, countParam, customFromParam, customToParam, includeZero, customIncomplete, datesIncomplete]
  );
  // The request goes out 400 ms after the last change to anything in it.
  const sentRequest = useDebouncedValue(request, REQUEST_DELAY_MS);
  const pending = request.ready && sentRequest !== request;

  useEffect(() => {
    if (!business?.id) return;
    if (!request.ready) {
      setLoading(false);
      return;
    }
    // Still waiting for the controls to settle; the change above aborted any earlier request.
    if (sentRequest !== request) return;
    const controller = new AbortController();
    fetchComparison(sentRequest, controller.signal);
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [business?.id, request, sentRequest]);

  /** Responses from a superseded request (signal aborted) never touch state. */
  const fetchComparison = async (req: CompareRequest, signal: AbortSignal) => {
    if (!business?.id) return;
    setLoading(true);
    setError(null);
    setBadRequest(null);
    setFailure(null);
    try {
      // buildApiUrl adds branch_id from the global branch selector.
      const params: Record<string, string> = {
        business_id: business.id,
        user_id: user?.id || '',
        from_date: req.fromDate,
        to_date: req.toDate,
        compare: req.mode,
      };
      if (req.mode === 'custom') {
        params.compare_from = req.customFrom;
        params.compare_to = req.customTo;
      } else {
        params.count = req.count;
      }
      if (req.includeZero) params.include_zero = 'true';
      const res = await fetch(buildApiUrl('/api/reports/profit-loss/compare', params), { signal });
      if (signal.aborted) return;
      if (res.ok) {
        const json = await res.json();
        if (signal.aborted) return;
        setData(json);
      } else if (res.status === 400) {
        const errorData = await res.json().catch(() => ({ error: 'Failed to fetch profit & loss comparison' }));
        if (signal.aborted) return;
        setBadRequest(errorData.error || 'Failed to fetch profit & loss comparison');
        setData(null);
      } else if (res.status === 403 || res.status === 401) {
        const errorData = await res.json().catch(() => ({ error: 'Failed to fetch profit & loss report' }));
        if (signal.aborted) return;
        setError({
          message: errorData.message || errorData.error || 'Failed to fetch profit & loss report',
          code: errorData.code || 'ACCESS_DENIED',
        });
        setData(null);
      } else {
        const errorData = await res.json().catch(() => ({}));
        if (signal.aborted) return;
        setFailure(
          typeof errorData?.error === 'string' && errorData.error ? errorData.error : 'Failed to load the comparison.'
        );
        setData(null);
      }
    } catch (e) {
      if (signal.aborted) return;
      console.error('Error fetching P&L comparison:', e);
      setFailure('Failed to load the comparison.');
      setData(null);
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  };

  if (error) {
    return (
      <div className="py-12">
        <AccessDenied module="reports" action="read" details={error.message} code={error.code || 'ACCESS_DENIED'} />
      </div>
    );
  }

  const sections = data && Array.isArray(data.sections) && Array.isArray(data.columns) ? data.sections : null;
  const allCollapsed = !!sections && sections.every((s) => collapsed.has(s.key));
  const toggle = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const renderTable = (d: CompareResponse) => {
    const n = d.columns.length;
    const showChange = n === 2;
    const colSpan = 1 + n + (showChange ? 2 : 0);
    const byKey = new Map(d.sections.map((s) => [s.key as string, s]));
    const onDrill = (target: DrillTarget, col: number) => setDrill({ target, col });
    const section = (key: string) => {
      const s = byKey.get(key);
      return (
        s && (
          <SectionRows
            key={key}
            section={s}
            colSpan={colSpan}
            collapsed={collapsed.has(key)}
            onToggle={() => toggle(key)}
            hideSubAccounts={hideSubAccounts}
            onDrill={onDrill}
          />
        )
      );
    };
    const otherDifference = d.elimination.net.some((v) => !isNil(v));

    return (
      <>
        <div className="overflow-x-auto">
          <table
            className="w-full border-collapse text-sm"
            style={{ minWidth: 560 + 140 * Math.max(0, n - 2) }}
            data-testid="plc-table"
          >
            <thead>
              <tr className="border-b-2 border-border text-xs font-semibold uppercase tracking-wide text-text-secondary">
                <th className="pb-2 pr-3 text-left font-semibold">Account</th>
                {d.columns.map((c, i) => (
                  <th
                    key={i}
                    className="pb-2 pl-3 text-right font-semibold whitespace-nowrap"
                    data-testid={`plc-col-${i}`}
                  >
                    {periodLabel({ from: c.from_date, to: c.to_date })}
                  </th>
                ))}
                {showChange && (
                  <>
                    <th className="pb-2 pl-3 text-right font-semibold whitespace-nowrap">Change (₹)</th>
                    <th className="pb-2 pl-3 text-right font-semibold whitespace-nowrap">Change (%)</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {section('operating_income')}
              {section('cost_of_goods_sold')}
              <ProfitRow label="Gross Profit" values={d.gross_profit} testKey="gross" />
              {section('operating_expense')}
              <ProfitRow label="Operating Profit" values={d.operating_profit} testKey="operating" />
              {section('other_income')}
              {section('other_expense')}
              <ProfitRow
                label="Net Profit/Loss"
                values={d.net_profit}
                testKey="net"
                final
                changeTestIds={{ amount: 'plc-change-amount-net', percent: 'plc-change-percent-net' }}
              />
              <tr className="border-b-2 border-border">
                <td
                  colSpan={colSpan}
                  className="pt-6 pb-2 text-xs font-semibold uppercase tracking-wide text-text-secondary"
                >
                  Key figures
                </td>
              </tr>
              <ProfitRow label="Profit Before Tax" values={d.profit_before_tax} />
              <ProfitRow label="EBIT" values={d.ebit} />
              <ProfitRow label="EBITDA" values={d.ebitda} />
            </tbody>
          </table>
        </div>

        <div className="mt-4 space-y-2 text-sm text-text-secondary">
          {d.columns.flatMap((c, i) => c.notes.map((note, j) => <p key={`${i}-${j}`}>{note}</p>))}
          {d.elimination.applied && (
            <p>
              {'Inter-branch sales and purchases are eliminated in the consolidated view.'}
              {otherDifference ? ' A difference between the two sides stays in net profit.' : ''}
            </p>
          )}
          <p>Each column is the Standard Profit & Loss for those dates.</p>
        </div>
      </>
    );
  };

  const subtitle =
    data && sections && data.columns.length > 0
      ? `${periodLabel({ from: data.columns[0].from_date, to: data.columns[0].to_date })}${
          data.branch ? ` · ${data.branch.name}` : data.is_consolidated ? ' · All branches' : ''
        }`
      : undefined;

  const drillColumn = drill && data?.columns?.[drill.col];

  return (
    <div className="space-y-4 md:space-y-6">
      <MobileReportHeader title="Profit and Loss (Compare)" subtitle={subtitle} />

      <Card>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Input type="date" label="From Date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          <Input type="date" label="To Date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
          <div className="w-full">
            <label className="type-label block mb-1.5" htmlFor="plc-compare-with">
              Compare with
            </label>
            <select
              id="plc-compare-with"
              className="input"
              value={mode}
              onChange={(e) => setMode(e.target.value as CompareMode)}
              data-testid="plc-compare-with"
            >
              <option value="previous_period">Previous period</option>
              <option value="previous_year">Same period last year</option>
              <option value="custom">Custom period</option>
            </select>
          </div>
          {!isCustom && (
            <div className="w-full">
              <label className="type-label block mb-1.5" htmlFor="plc-count">
                Number of periods
              </label>
              <select
                id="plc-count"
                className="input"
                value={count}
                onChange={(e) => setCount(e.target.value)}
                data-testid="plc-count"
              >
                <option value="1">1</option>
                <option value="2">2</option>
                <option value="3">3</option>
              </select>
            </div>
          )}
          {isCustom && (
            <>
              <Input
                type="date"
                label="Compare From"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                data-testid="plc-custom-from"
              />
              <Input
                type="date"
                label="Compare To"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                data-testid="plc-custom-to"
              />
            </>
          )}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-4 text-sm">
          <label className="inline-flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={includeZero} onChange={(e) => setIncludeZero(e.target.checked)} />
            Show accounts with no transactions
          </label>
          <label className="inline-flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={hideSubAccounts} onChange={(e) => setHideSubAccounts(e.target.checked)} />
            Hide sub-accounts
          </label>
          {sections && (
            <button
              type="button"
              className="text-primary-600 hover:underline"
              onClick={() => setCollapsed(allCollapsed ? new Set() : new Set(sections.map((s) => s.key)))}
            >
              {allCollapsed ? 'Expand all' : 'Collapse all'}
            </button>
          )}
          {(loading || pending) && <Loader2 className="w-4 h-4 animate-spin text-primary-500" />}
        </div>
      </Card>

      <Card>
        {customIncomplete ? (
          <p className="py-8 text-center text-text-secondary">Choose both dates for the period to compare with.</p>
        ) : datesIncomplete ? (
          <p className="py-8 text-center text-text-secondary">Enter complete dates to see the comparison.</p>
        ) : badRequest ? (
          <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-900" role="alert">
            {badRequest}
          </div>
        ) : failure ? (
          <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-900" role="alert">
            {failure}
          </div>
        ) : (loading || pending) && !data ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
          </div>
        ) : !data || !sections ? (
          <p className="py-8 text-center text-text-secondary">No data available</p>
        ) : (
          renderTable(data)
        )}
      </Card>

      {business?.id && data?.columns?.length ? (
        <ProfitLossDrilldownPanel
          target={drill && drillColumn ? drill.target : null}
          onClose={() => setDrill(null)}
          businessId={business.id}
          userId={user?.id || ''}
          fromDate={(drillColumn || data.columns[0]).from_date}
          toDate={(drillColumn || data.columns[0]).to_date}
        />
      ) : null}
    </div>
  );
}

export default withPageAuth('reports', 'read', ProfitLossComparePage);
