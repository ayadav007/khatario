'use client';

export const dynamic = 'force-dynamic';

import React, { useState, useEffect } from 'react';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Loader2, ChevronRight, ChevronDown, CheckCircle2, AlertTriangle } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { buildApiUrl } from '@/lib/api-helpers';
import { format, parseISO } from 'date-fns';
import { withPageAuth } from '@/lib/auth/withPageAuth';
import { AccessDenied } from '@/components/common/AccessDenied';
import { MobileReportHeader } from '@/components/layout/MobileReportHeader';
import { ProfitLossDrilldownPanel, type DrillTarget } from '@/components/reports/ProfitLossDrilldownPanel';
import { SCHEDULE3_LINE_LABELS, CREDIT_LINES, type Schedule3Line } from '@/lib/accounting/schedule3-lines';
import type { Schedule3Statement, S3LineBlock, S3Row } from '@/lib/reports/schedule3-pl';

interface Schedule3Response {
  period: { from_date: string; to_date: string; financial_year?: string | null };
  previous_period: { from_date: string; to_date: string };
  branch: { id: string; name: string } | null;
  is_consolidated: boolean;
  current: Schedule3Statement;
  previous: Schedule3Statement;
  agreement: { standard_net_profit: number; difference: number };
}

const inr = (n: number) =>
  `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const isNil = (n: number | null | undefined) => n == null || Math.abs(n) < 0.005;

const EXPENSE_LINES: Schedule3Line[] = [
  'materials_consumed',
  'purchases_stock_in_trade',
  'changes_in_inventories',
  'employee_benefits',
  'finance_costs',
  'depreciation_amortisation',
  'other_expenses',
];

const EXPANDABLE_LINES: Schedule3Line[] = [
  'revenue_from_operations',
  'other_income',
  ...EXPENSE_LINES,
  'exceptional_items',
  'current_tax',
  'deferred_tax',
];

const rowKey = (r: S3Row) => (r.id ? `id:${r.id}` : `label:${r.label}`);

/** Current and previous rows side by side: matched by id, or by label for computed rows. */
function mergeRows(current: S3Row[], previous: S3Row[]) {
  const prevByKey = new Map(previous.map((r) => [rowKey(r), r]));
  const seen = new Set<string>();
  const out: Array<{ key: string; current?: S3Row; previous?: S3Row }> = [];
  for (const c of current) {
    const key = rowKey(c);
    seen.add(key);
    out.push({ key, current: c, previous: prevByKey.get(key) });
  }
  for (const p of previous) {
    const key = rowKey(p);
    if (!seen.has(key)) out.push({ key, previous: p });
  }
  return out;
}

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

const cellParticulars = 'py-2 pr-3 text-left align-top';
const cellAmount = 'py-2 pl-3 text-right align-top whitespace-nowrap';

function Numeral({ n }: { n?: string }) {
  return <span className="inline-block w-10 shrink-0">{n ?? ''}</span>;
}

/** A Roman-numbered or sub-total row: bold when numbered. */
function TotalRow({
  numeral,
  label,
  current,
  previous,
  testId,
  nil = false,
  bold = true,
  className = '',
}: {
  numeral?: string;
  label: string;
  current?: number;
  previous?: number;
  testId?: string;
  nil?: boolean;
  bold?: boolean;
  className?: string;
}) {
  return (
    <tr className={`border-b border-border/60 ${bold ? 'font-bold' : 'font-medium'} ${className}`}>
      <td className={cellParticulars}>
        <span className="flex">
          <Numeral n={numeral} />
          <span>{label}</span>
        </span>
      </td>
      <td className={cellAmount}>
        <Amount value={nil ? 0 : current} testId={testId} />
      </td>
      <td className={cellAmount}>
        <Amount value={nil ? 0 : previous} />
      </td>
    </tr>
  );
}

function HeadingRow({ numeral, label }: { numeral: string; label: string }) {
  return (
    <tr className="border-b border-border/60 font-bold">
      <td className={cellParticulars}>
        <span className="flex">
          <Numeral n={numeral} />
          <span>{label}</span>
        </span>
      </td>
      <td className={cellAmount} />
      <td className={cellAmount} />
    </tr>
  );
}

function LineRows({
  numeral,
  prefix = '',
  indent = false,
  current,
  previous,
  expanded,
  onToggle,
  onDrill,
}: {
  numeral?: string;
  prefix?: string;
  indent?: boolean;
  current: S3LineBlock;
  previous: S3LineBlock;
  expanded: boolean;
  onToggle: () => void;
  onDrill: (t: DrillTarget) => void;
}) {
  const key = current.key;
  const rows = mergeRows(current.rows ?? [], previous?.rows ?? []);
  const canExpand = rows.length > 0;
  const section = CREDIT_LINES.has(key) ? 'operating_income' : 'operating_expense';
  const label = `${prefix}${SCHEDULE3_LINE_LABELS[key]}`;

  return (
    <>
      <tr
        className={`border-b border-border/60 ${numeral ? 'font-bold' : ''} ${canExpand ? 'cursor-pointer hover:bg-primary-50' : ''}`}
        onClick={canExpand ? onToggle : undefined}
      >
        <td className={cellParticulars}>
          <span className="flex">
            <Numeral n={numeral} />
            {indent && <span className="inline-block w-4 shrink-0" />}
            {canExpand ? (
              <button
                type="button"
                aria-expanded={expanded}
                className="flex items-start gap-1 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
              >
                {expanded ? (
                  <ChevronDown className="mt-0.5 h-4 w-4 shrink-0" />
                ) : (
                  <ChevronRight className="mt-0.5 h-4 w-4 shrink-0" />
                )}
                <span>{label}</span>
              </button>
            ) : (
              <span className="flex items-start gap-1">
                <span className="inline-block h-4 w-4 shrink-0" />
                <span>{label}</span>
              </span>
            )}
          </span>
        </td>
        <td className={cellAmount}>
          <Amount value={current.amount} testId={`s3-line-${key}`} />
        </td>
        <td className={cellAmount}>
          <Amount value={previous?.amount} />
        </td>
      </tr>
      {expanded &&
        rows.map((r) => {
          const c = r.current;
          const drillable = !!c && !!c.id;
          return (
            <tr key={r.key} className="border-b border-border/40 text-sm text-text-secondary" data-testid="s3-detail-row">
              <td className={cellParticulars}>
                <span className="flex" style={{ paddingLeft: indent ? 76 : 60 }}>
                  {(c ?? r.previous)?.account_code && (
                    <span className="mr-2 font-mono text-xs">{(c ?? r.previous)?.account_code}</span>
                  )}
                  <span>{(c ?? r.previous)?.label}</span>
                </span>
              </td>
              <td className={cellAmount}>
                {drillable && c ? (
                  <button
                    type="button"
                    title="Click to see what makes up this amount"
                    onClick={() =>
                      onDrill({ kind: 'account', label: c.label, accountIds: [c.id as string], section })
                    }
                    className="hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
                  >
                    <Amount value={c.amount} />
                  </button>
                ) : (
                  <Amount value={c?.amount} />
                )}
              </td>
              <td className={cellAmount}>
                <Amount value={r.previous?.amount} />
              </td>
            </tr>
          );
        })}
    </>
  );
}

function ProfitLossScheduleIIIPage() {
  const { business, user } = useAuth();
  const [drill, setDrill] = useState<DrillTarget | null>(null);
  const [data, setData] = useState<Schedule3Response | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ message: string; code?: string } | null>(null);
  const [expanded, setExpanded] = useState<Set<Schedule3Line>>(new Set());
  const [fromDate, setFromDate] = useState(() => {
    const now = new Date();
    const currentYear = now.getFullYear();
    const fyStart = new Date(currentYear, 3, 1);
    return now < fyStart ? format(new Date(currentYear - 1, 3, 1), 'yyyy-MM-dd') : format(fyStart, 'yyyy-MM-dd');
  });
  const [toDate, setToDate] = useState(format(new Date(), 'yyyy-MM-dd'));

  useEffect(() => {
    if (!business?.id) return;
    const controller = new AbortController();
    fetchStatement(controller.signal);
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [business?.id, fromDate, toDate]);

  /** Responses from a superseded request (signal aborted) never touch state. */
  const fetchStatement = async (signal: AbortSignal) => {
    if (!business?.id) return;
    setLoading(true);
    setError(null);
    try {
      // buildApiUrl adds branch_id from the global branch selector.
      const params: Record<string, string> = {
        business_id: business.id,
        user_id: user?.id || '',
        from_date: fromDate,
        to_date: toDate,
      };
      const res = await fetch(buildApiUrl('/api/reports/profit-loss/schedule-iii', params), { signal });
      if (signal.aborted) return;
      if (res.ok) {
        const json = await res.json();
        if (signal.aborted) return;
        setData(json);
      } else {
        const errorData = await res.json().catch(() => ({ error: 'Failed to fetch profit & loss report' }));
        if (signal.aborted) return;
        setError({
          message: errorData.message || errorData.error || 'Failed to fetch profit & loss report',
          code: errorData.code || (res.status === 403 || res.status === 401 ? 'ACCESS_DENIED' : 'FETCH_ERROR'),
        });
        if (res.status === 403 || res.status === 401) setData(null);
      }
    } catch (e) {
      if (signal.aborted) return;
      console.error('Error fetching Schedule III P&L:', e);
      setError({ message: 'Failed to fetch profit & loss report', code: 'NETWORK_ERROR' });
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  };

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-100px)]">
        <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="py-12">
        <AccessDenied module="reports" action="read" details={error.message} code={error.code || 'ACCESS_DENIED'} />
      </div>
    );
  }

  if (!data || !data.current?.lines || !data.previous?.lines) {
    return (
      <div className="text-center py-12">
        <p className="text-text-secondary">No data available</p>
      </div>
    );
  }

  const cur = data.current;
  const prev = data.previous;
  const expandable = EXPANDABLE_LINES.filter(
    (k) => (cur.lines[k]?.rows?.length ?? 0) > 0 || (prev.lines[k]?.rows?.length ?? 0) > 0
  );
  const allCollapsed = expandable.every((k) => !expanded.has(k));
  const toggle = (key: Schedule3Line) =>
    setExpanded((p) => {
      const next = new Set(p);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const line = (key: Schedule3Line, opts: { numeral?: string; prefix?: string; indent?: boolean } = {}) => (
    <LineRows
      key={key}
      {...opts}
      current={cur.lines[key]}
      previous={prev.lines[key]}
      expanded={expanded.has(key)}
      onToggle={() => toggle(key)}
      onDrill={setDrill}
    />
  );

  const showElimination = !isNil(cur.elimination_net) || !isNil(prev.elimination_net);
  const agrees = Math.abs(data.agreement.difference) < 0.01;
  const dateLabel = (iso: string) => format(parseISO(iso), 'dd MMM yyyy');

  return (
    <div className="space-y-4 md:space-y-6">
      <MobileReportHeader
        title="Profit and Loss (Schedule III)"
        subtitle={`${dateLabel(data.period.from_date)} to ${dateLabel(data.period.to_date)}${
          data.branch ? ` · ${data.branch.name}` : data.is_consolidated ? ' · All branches' : ''
        }`}
      />

      <Card>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Input type="date" label="From Date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          <Input type="date" label="To Date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-4 text-sm">
          <button
            type="button"
            className="text-primary-600 hover:underline"
            onClick={() => setExpanded(allCollapsed ? new Set(expandable) : new Set())}
          >
            {allCollapsed ? 'Expand all' : 'Collapse all'}
          </button>
          {loading && <Loader2 className="w-4 h-4 animate-spin text-primary-500" />}
        </div>
      </Card>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-sm" data-testid="s3-statement">
            <thead>
              <tr className="border-b-2 border-border text-xs font-semibold uppercase tracking-wide text-text-secondary">
                <th className="pb-2 pr-3 text-left font-semibold">Particulars</th>
                <th className="pb-2 pl-3 text-right font-semibold whitespace-nowrap">{dateLabel(data.period.to_date)}</th>
                <th className="pb-2 pl-3 text-right font-semibold whitespace-nowrap">
                  {dateLabel(data.previous_period.to_date)}
                </th>
              </tr>
            </thead>
            <tbody>
              {line('revenue_from_operations', { numeral: 'I' })}
              {line('other_income', { numeral: 'II' })}
              <TotalRow numeral="III" label="Total income (I + II)" current={cur.total_income} previous={prev.total_income} />
              <HeadingRow numeral="IV" label="Expenses" />
              {EXPENSE_LINES.map((k) => line(k, { indent: true }))}
              <TotalRow
                label="Total expenses"
                current={cur.total_expenses}
                previous={prev.total_expenses}
                bold={false}
              />
              {showElimination && (
                <TotalRow
                  label="Inter-branch difference (not eliminated)"
                  current={cur.elimination_net}
                  previous={prev.elimination_net}
                  bold={false}
                />
              )}
              <TotalRow
                numeral="V"
                label="Profit before exceptional and extraordinary items and tax (III − IV)"
                current={cur.profit_before_exceptional_and_tax}
                previous={prev.profit_before_exceptional_and_tax}
              />
              {line('exceptional_items', { numeral: 'VI' })}
              <TotalRow
                numeral="VII"
                label="Profit before extraordinary items and tax (V − VI)"
                current={cur.profit_before_tax}
                previous={prev.profit_before_tax}
              />
              <TotalRow numeral="VIII" label="Extraordinary items" nil />
              <TotalRow
                numeral="IX"
                label="Profit before tax (VII − VIII)"
                current={cur.profit_before_tax}
                previous={prev.profit_before_tax}
              />
              <HeadingRow numeral="X" label="Tax expense:" />
              {line('current_tax', { prefix: '(1) ', indent: true })}
              {line('deferred_tax', { prefix: '(2) ', indent: true })}
              <TotalRow
                numeral="XI"
                label="Profit for the period from continuing operations (IX − X)"
                current={cur.profit_for_period}
                previous={prev.profit_for_period}
              />
              <TotalRow numeral="XII" label="Profit/(loss) from discontinuing operations" nil />
              <TotalRow numeral="XIII" label="Tax expense of discontinuing operations" nil />
              <TotalRow
                numeral="XIV"
                label="Profit/(loss) from discontinuing operations (after tax) (XII − XIII)"
                nil
              />
              <TotalRow
                numeral="XV"
                label="Profit for the period (XI + XIV)"
                current={cur.profit_for_period}
                previous={prev.profit_for_period}
                testId="s3-profit-for-period"
                className="border-t-2 border-border bg-gray-100"
              />
            </tbody>
          </table>
        </div>

        <div className="mt-4 space-y-2 text-sm text-text-secondary">
          <p>
            Schedule III (Division I) layout under the Companies Act, 2013. Same books as the Standard tab; only the
            grouping differs.
          </p>
          {cur.stock_basis === 'perpetual' && (
            <p>Changes in inventories is worked out as cost of goods sold less purchases taken into stock.</p>
          )}
          <p>Earnings per share is not shown because share details are not kept in Khatario.</p>
          <div
            className={`flex items-start gap-2 ${agrees ? 'text-green-700' : 'text-amber-800'}`}
            data-testid="s3-agreement"
          >
            {agrees ? <CheckCircle2 className="w-4 h-4 mt-0.5" /> : <AlertTriangle className="w-4 h-4 mt-0.5" />}
            <span>
              {agrees
                ? 'Agrees with the Standard Profit & Loss.'
                : `Differs from the Standard Profit & Loss by ${inr(data.agreement.difference)}. Please report this.`}
            </span>
          </div>
        </div>
      </Card>

      {business?.id && (
        <ProfitLossDrilldownPanel
          target={drill}
          onClose={() => setDrill(null)}
          businessId={business.id}
          userId={user?.id || ''}
          fromDate={data.period.from_date}
          toDate={data.period.to_date}
          financialYear={data.period.financial_year ?? undefined}
        />
      )}
    </div>
  );
}

export default withPageAuth('reports', 'read', ProfitLossScheduleIIIPage);
