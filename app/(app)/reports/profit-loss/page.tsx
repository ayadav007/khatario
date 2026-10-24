'use client';

export const dynamic = 'force-dynamic';

import React, { useState, useEffect } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import {
  Loader2,
  Download,
  FileSpreadsheet,
  Printer,
  ChevronRight,
  ChevronDown,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { buildApiUrl, forPdfPrintInBrowser } from '@/lib/api-helpers';
import { format } from 'date-fns';
import { withPageAuth } from '@/lib/auth/withPageAuth';
import { AccessDenied } from '@/components/common/AccessDenied';
import { MobileReportHeader } from '@/components/layout/MobileReportHeader';
import { ProfitLossDrilldownPanel, type DrillTarget } from '@/components/reports/ProfitLossDrilldownPanel';
import type {
  PeriodicCogsSchedule,
  PlAccountNode,
  PlSectionBlock,
  ProfitAndLoss,
  ReportSection,
} from '@/lib/reports/profit-loss';

interface PnLData {
  period: { from_date: string; to_date: string; financial_year?: string | null };
  branch: { id: string; name: string } | null;
  is_consolidated: boolean;
  sections: PlSectionBlock[];
  gross_profit: number;
  operating_profit: number;
  net_profit: number;
  earnings?: ProfitAndLoss['earnings'];
  elimination: ProfitAndLoss['elimination'];
  inventory_model: 'periodic' | 'perpetual';
  periodic_cogs: PeriodicCogsSchedule | null;
  ledger_check: ProfitAndLoss['ledger_check'];
  warnings?: Array<{ code: string; message: string; severity: 'info' | 'warn' | 'error' }>;
}

const inr = (n: number) =>
  `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const subtreeIds = (n: PlAccountNode): string[] => [n.id, ...n.children.flatMap(subtreeIds)];

const accountTarget = (n: PlAccountNode, section: ReportSection): DrillTarget => ({
  kind: 'account',
  label: `${n.account_code} ${n.account_name}`,
  accountIds: [n.id],
  section,
});

function sectionTarget(block: PlSectionBlock, schedule: PeriodicCogsSchedule | null): DrillTarget | undefined {
  const rows: Extract<DrillTarget, { kind: 'breakdown' }>['rows'] = [];
  if (block.key === 'cost_of_goods_sold' && schedule) {
    rows.push({ label: 'Opening Stock', amount: schedule.opening_stock, sign: 1, target: { kind: 'opening_stock', label: 'Opening Stock' } });
    rows.push({ label: 'Purchases (net of returns)', amount: schedule.purchases, sign: 1, target: { kind: 'purchases', label: 'Purchases' } });
    rows.push({ label: 'Closing Stock', amount: schedule.closing_stock, sign: -1, target: { kind: 'closing_stock', label: 'Closing Stock' } });
  }
  for (const n of block.accounts) {
    rows.push({
      label: `${n.account_code} ${n.account_name}`,
      amount: n.total,
      sign: 1,
      target: n.children.length
        ? { kind: 'account', label: n.account_name, accountIds: subtreeIds(n), section: block.key }
        : accountTarget(n, block.key),
    });
  }
  return rows.length ? { kind: 'breakdown', label: `Total for ${block.label}`, total: block.total, rows } : undefined;
}

function profitTarget(label: string, total: number, parts: Array<{ label: string; amount: number; sign: 1 | -1; target?: DrillTarget }>): DrillTarget {
  return { kind: 'breakdown', label, total, rows: parts.filter((p) => Math.abs(p.amount) > 0.004) };
}

function DrillRow({ onClick, className = '', children }: { onClick?: () => void; className?: string; children: React.ReactNode }) {
  if (!onClick) return <div className={`flex justify-between items-center ${className}`}>{children}</div>;
  return (
    <button
      type="button"
      onClick={onClick}
      title="Click to see what makes up this amount"
      className={`group flex w-full justify-between items-center text-left hover:bg-primary-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 ${className}`}
    >
      {children}
    </button>
  );
}

function Amount({ value, drill, className = '', testId }: { value: number; drill?: boolean; className?: string; testId?: string }) {
  return (
    <span
      className={`flex items-center gap-1 tabular-nums ${value < 0 ? 'text-red-600' : ''} ${className}`}
      data-testid={testId}
      data-value={value}
    >
      {inr(value)}
      {drill && <ChevronRight className="w-4 h-4 text-text-secondary opacity-40 group-hover:opacity-100" />}
    </span>
  );
}

function AccountRows({
  nodes,
  section,
  depth,
  onDrill,
  hideSubAccounts = false,
}: {
  nodes: PlAccountNode[];
  section: ReportSection;
  depth: number;
  onDrill: (t: DrillTarget) => void;
  hideSubAccounts?: boolean;
}) {
  return (
    <>
      {nodes.map((n) => {
        const rolledUp = hideSubAccounts && n.children.length > 0;
        return (
        <React.Fragment key={n.id}>
          <DrillRow
            onClick={() =>
              onDrill(rolledUp ? { kind: 'account', label: n.account_name, accountIds: subtreeIds(n), section } : accountTarget(n, section))
            }
            className="py-2 pr-2 border-b border-border/60"
          >
            <span className="flex items-center gap-2 min-w-0" style={{ paddingLeft: 16 + depth * 20 }} data-testid="pl-account-row">
              <span className="font-mono text-xs text-text-secondary">{n.account_code}</span>
              <span className="truncate">{n.account_name}</span>
              {!n.is_active && (
                <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-700 text-[10px] uppercase tracking-wide">Inactive</span>
              )}
            </span>
            <Amount value={rolledUp ? n.total : n.amount} drill testId={depth === 0 ? 'pl-root-amount' : 'pl-child-amount'} />
          </DrillRow>
          {n.children.length > 0 && !rolledUp && (
            <>
              <AccountRows nodes={n.children} section={section} depth={depth + 1} onDrill={onDrill} />
              <DrillRow
                onClick={() => onDrill({ kind: 'account', label: n.account_name, accountIds: subtreeIds(n), section })}
                className="py-2 pr-2 border-b border-border/60 font-medium"
              >
                <span style={{ paddingLeft: 16 + depth * 20 }}>Total for {n.account_name}</span>
                <Amount value={n.total} drill />
              </DrillRow>
            </>
          )}
        </React.Fragment>
        );
      })}
    </>
  );
}

function SectionBlock({
  block,
  schedule,
  collapsed,
  onToggle,
  onDrill,
  hideSubAccounts,
}: {
  block: PlSectionBlock;
  schedule: PeriodicCogsSchedule | null;
  collapsed: boolean;
  onToggle: () => void;
  onDrill: (t: DrillTarget) => void;
  hideSubAccounts: boolean;
}) {
  const showSchedule = block.key === 'cost_of_goods_sold' && schedule;
  const empty = block.accounts.length === 0 && !showSchedule;
  const target = sectionTarget(block, schedule);
  return (
    <div data-testid={`pl-section-${block.key}`}>
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-1 pt-5 pb-2 text-left font-semibold text-text-primary"
        aria-expanded={!collapsed}
      >
        {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        {block.label}
      </button>
      {!collapsed && (
        <>
          {showSchedule && (
            <>
              <DrillRow onClick={() => onDrill({ kind: 'opening_stock', label: 'Opening Stock' })} className="py-2 pr-2 border-b border-border/60">
                <span className="pl-4">Opening Stock</span>
                <Amount value={schedule.opening_stock} drill />
              </DrillRow>
              <DrillRow onClick={() => onDrill({ kind: 'purchases', label: 'Purchases' })} className="py-2 pr-2 border-b border-border/60">
                <span className="pl-4">Add: Purchases (net of returns)</span>
                <Amount value={schedule.purchases} drill />
              </DrillRow>
              <DrillRow onClick={() => onDrill({ kind: 'closing_stock', label: 'Closing Stock' })} className="py-2 pr-2 border-b border-border/60">
                <span className="pl-4">Less: Closing Stock</span>
                <Amount value={-schedule.closing_stock} drill />
              </DrillRow>
            </>
          )}
          <AccountRows nodes={block.accounts} section={block.key} depth={0} onDrill={onDrill} hideSubAccounts={hideSubAccounts} />
          {empty && <p className="pl-4 py-2 text-sm text-text-secondary">No transactions in this period.</p>}
        </>
      )}
      <DrillRow
        onClick={target ? () => onDrill(target) : undefined}
        className="py-2 pr-2 border-t border-border font-semibold"
      >
        <span className="pl-4">Total for {block.label}</span>
        <Amount value={block.total} drill={!!target} testId={`pl-section-total-${block.key}`} />
      </DrillRow>
    </div>
  );
}

function ProfitRow({ label, value, onClick, final = false }: { label: string; value: number; onClick: () => void; final?: boolean }) {
  return (
    <DrillRow
      onClick={onClick}
      className={`mt-3 px-4 rounded-lg font-bold ${final ? 'py-4 text-lg bg-gray-100 border-t-2 border-border' : 'py-3 bg-slate-50'}`}
    >
      <span>{label}</span>
      <Amount
        value={value}
        drill
        className={value >= 0 ? 'text-green-700' : 'text-red-600'}
        testId={`pl-profit-${label.toLowerCase().replace(/[^a-z]+/g, '-')}`}
      />
    </DrillRow>
  );
}

function ProfitLossPage() {
  const { business, user } = useAuth();
  const [drill, setDrill] = useState<DrillTarget | null>(null);
  const [data, setData] = useState<PnLData | null>(null);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<{ message: string; code?: string } | null>(null);
  const [includeZero, setIncludeZero] = useState(false);
  const [hideSubAccounts, setHideSubAccounts] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [fromDate, setFromDate] = useState(() => {
    const now = new Date();
    const currentYear = now.getFullYear();
    const fyStart = new Date(currentYear, 3, 1);
    return now < fyStart ? format(new Date(currentYear - 1, 3, 1), 'yyyy-MM-dd') : format(fyStart, 'yyyy-MM-dd');
  });
  const [toDate, setToDate] = useState(format(new Date(), 'yyyy-MM-dd'));

  const getProfitLossPdfUrl = (forPrint: boolean) => {
    if (!business?.id) return null;
    const url = buildApiUrl('/api/reports/profit-loss/pdf', {
      business_id: business.id,
      user_id: user?.id || '',
      from_date: fromDate,
      to_date: toDate,
    });
    return forPrint ? forPdfPrintInBrowser(url) : url;
  };

  const handleDownloadPdf = async () => {
    setDownloading(true);
    try {
      const url = getProfitLossPdfUrl(false);
      if (url) window.open(url, '_blank');
    } finally {
      setDownloading(false);
    }
  };

  const handlePrint = () => {
    const url = getProfitLossPdfUrl(true);
    if (url) window.open(url, '_blank');
  };

  const handleDownloadExcel = () => {
    if (!business?.id) return;
    const params: Record<string, string> = {
      business_id: business.id,
      user_id: user?.id || '',
      from_date: fromDate,
      to_date: toDate,
    };
    if (includeZero) params.include_zero = 'true';
    window.open(buildApiUrl('/api/reports/profit-loss/excel', params), '_blank');
  };

  useEffect(() => {
    if (business?.id) fetchPnL();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [business?.id, fromDate, toDate, includeZero]);

  const fetchPnL = async () => {
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
      if (includeZero) params.include_zero = 'true';
      const res = await fetch(buildApiUrl('/api/reports/profit-loss', params));
      if (res.ok) {
        setData(await res.json());
      } else {
        const errorData = await res.json().catch(() => ({ error: 'Failed to fetch profit & loss report' }));
        setError({
          message: errorData.message || errorData.error || 'Failed to fetch profit & loss report',
          code: errorData.code || (res.status === 403 || res.status === 401 ? 'ACCESS_DENIED' : 'FETCH_ERROR'),
        });
        if (res.status === 403 || res.status === 401) setData(null);
      }
    } catch (e) {
      console.error('Error fetching P&L:', e);
      setError({ message: 'Failed to fetch profit & loss report', code: 'NETWORK_ERROR' });
    } finally {
      setLoading(false);
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

  if (!data || !Array.isArray(data.sections)) {
    return (
      <div className="text-center py-12">
        <p className="text-text-secondary">No data available</p>
      </div>
    );
  }

  const byKey = Object.fromEntries(data.sections.map((s) => [s.key, s])) as Record<ReportSection, PlSectionBlock>;
  const toggle = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const allCollapsed = collapsed.size === data.sections.length;
  const section = (key: ReportSection) =>
    byKey[key] && (
      <SectionBlock
        block={byKey[key]}
        schedule={data.periodic_cogs}
        collapsed={collapsed.has(key)}
        onToggle={() => toggle(key)}
        onDrill={setDrill}
        hideSubAccounts={hideSubAccounts}
      />
    );

  const sectionPart = (key: ReportSection, sign: 1 | -1) => ({
    label: byKey[key].label,
    amount: byKey[key].total,
    sign,
    target: sectionTarget(byKey[key], data.periodic_cogs),
  });
  const grossTarget = profitTarget('Gross Profit', data.gross_profit, [
    sectionPart('operating_income', 1),
    sectionPart('cost_of_goods_sold', -1),
  ]);
  const operatingTarget = profitTarget('Operating Profit', data.operating_profit, [
    { label: 'Gross Profit', amount: data.gross_profit, sign: 1, target: grossTarget },
    sectionPart('operating_expense', -1),
  ]);
  const netTarget = profitTarget('Net Profit/Loss', data.net_profit, [
    { label: 'Operating Profit', amount: data.operating_profit, sign: 1, target: operatingTarget },
    sectionPart('other_income', 1),
    sectionPart('other_expense', -1),
    ...(Math.abs(data.elimination.net) > 0.004
      ? [{ label: 'Inter-branch difference (not eliminated)', amount: data.elimination.net, sign: 1 as const }]
      : []),
  ]);

  const e = data.earnings;
  const pbtTarget = e && profitTarget('Profit Before Tax', e.profit_before_tax, [
    { label: 'Net Profit/Loss', amount: data.net_profit, sign: 1, target: netTarget },
    { label: 'Add: Tax expense (current + deferred)', amount: e.tax, sign: 1 },
  ]);
  const ebitTarget = e && pbtTarget && profitTarget('EBIT', e.ebit, [
    { label: 'Profit Before Tax', amount: e.profit_before_tax, sign: 1, target: pbtTarget },
    { label: 'Add: Finance costs (interest, financial expenses)', amount: e.finance_cost, sign: 1 },
    { label: 'Less: Interest income', amount: e.interest_income, sign: -1 },
  ]);
  const ebitdaTarget = e && ebitTarget && profitTarget('EBITDA', e.ebitda, [
    { label: 'EBIT', amount: e.ebit, sign: 1, target: ebitTarget },
    { label: 'Add: Depreciation & amortisation', amount: e.depreciation_amortisation, sign: 1 },
  ]);

  const agrees = Math.abs(data.ledger_check.difference) < 0.01;

  return (
    <div className="space-y-4 md:space-y-6">
      <MobileReportHeader
        title="Profit and Loss"
        subtitle={`${format(new Date(data.period.from_date), 'dd MMM yyyy')} to ${format(new Date(data.period.to_date), 'dd MMM yyyy')}${
          data.branch ? ` · ${data.branch.name}` : data.is_consolidated ? ' · All branches' : ''
        }`}
        actions={
          <>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={handlePrint}
              title="Opens the PDF in a tab for printing (Ctrl+P). Use Download PDF to save the file."
            >
              <Printer className="w-4 h-4 md:mr-2" />
              <span className="hidden md:inline">Print</span>
            </Button>
            <Button type="button" variant="secondary" size="sm" onClick={handleDownloadExcel} data-testid="pl-export-excel">
              <FileSpreadsheet className="w-4 h-4 md:mr-2" />
              <span className="hidden md:inline">Export Excel</span>
            </Button>
            <Button size="sm" onClick={handleDownloadPdf} isLoading={downloading}>
              <Download className="w-4 h-4 md:mr-2" />
              <span className="hidden md:inline">Download PDF</span>
            </Button>
          </>
        }
      />

      <Card>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Input type="date" label="From Date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          <Input type="date" label="To Date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-4 text-sm">
          <label className="inline-flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={includeZero} onChange={(e) => setIncludeZero(e.target.checked)} />
            Show accounts with no transactions
          </label>
          <label className="inline-flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={hideSubAccounts}
              onChange={(e) => setHideSubAccounts(e.target.checked)}
              data-testid="pl-hide-sub-accounts"
            />
            Hide sub-accounts
          </label>
          <button
            type="button"
            className="text-primary-600 hover:underline"
            onClick={() => setCollapsed(allCollapsed ? new Set() : new Set(data.sections.map((s) => s.key)))}
          >
            {allCollapsed ? 'Expand all' : 'Collapse all'}
          </button>
          {loading && <Loader2 className="w-4 h-4 animate-spin text-primary-500" />}
        </div>
      </Card>

      {data.warnings && data.warnings.length > 0 && (
        <div className="space-y-2">
          {data.warnings.map((w, idx) => (
            <div
              key={`${w.code}-${idx}`}
              className={`rounded-lg border p-4 flex gap-3 items-start ${
                w.severity === 'error'
                  ? 'border-red-300 bg-red-50 text-red-900'
                  : w.severity === 'warn'
                  ? 'border-amber-300 bg-amber-50 text-amber-900'
                  : 'border-sky-300 bg-sky-50 text-sky-900'
              }`}
            >
              <span className="font-semibold uppercase text-xs tracking-wide pt-0.5">
                {w.severity === 'error' ? 'Error' : w.severity === 'warn' ? 'Warning' : 'Info'}
              </span>
              <span className="text-sm leading-relaxed">{w.message}</span>
            </div>
          ))}
        </div>
      )}

      <Card>
        <div className="flex justify-between border-b-2 border-border pb-2 text-xs font-semibold uppercase tracking-wide text-text-secondary">
          <span>Account</span>
          <span className="pr-7">Total</span>
        </div>

        {section('operating_income')}
        {section('cost_of_goods_sold')}
        <ProfitRow label="Gross Profit" value={data.gross_profit} onClick={() => setDrill(grossTarget)} />

        {section('operating_expense')}
        <ProfitRow label="Operating Profit" value={data.operating_profit} onClick={() => setDrill(operatingTarget)} />

        {section('other_income')}
        {section('other_expense')}
        <ProfitRow label="Net Profit/Loss" value={data.net_profit} onClick={() => setDrill(netTarget)} final />

        {e && pbtTarget && ebitTarget && ebitdaTarget && (
          <div className="mt-6" data-testid="pl-earnings">
            <div className="border-b-2 border-border pb-2 text-xs font-semibold uppercase tracking-wide text-text-secondary">
              Key figures
            </div>
            <ProfitRow label="Profit Before Tax" value={e.profit_before_tax} onClick={() => setDrill(pbtTarget)} />
            <ProfitRow label="EBIT" value={e.ebit} onClick={() => setDrill(ebitTarget)} />
            <ProfitRow label="EBITDA" value={e.ebitda} onClick={() => setDrill(ebitdaTarget)} />
            <p className="mt-2 text-xs text-text-secondary">
              Worked back from net profit: tax (5210, 5211), finance costs (5203, 5205), interest income (4202) and
              depreciation (5204), including sub-accounts created under them.
            </p>
          </div>
        )}

        {data.elimination.applied && (
          <p className="mt-4 text-sm text-text-secondary">
            Inter-branch sales and purchases are eliminated in the consolidated view
            {Math.abs(data.elimination.net) > 0.004
              ? `; the two sides differ by ${inr(data.elimination.net)}, which stays in net profit.`
              : '.'}
          </p>
        )}

        <div
          className={`mt-4 flex items-start gap-2 text-sm ${agrees ? 'text-green-700' : 'text-amber-800'}`}
          data-testid="pl-ledger-check"
        >
          {agrees ? <CheckCircle2 className="w-4 h-4 mt-0.5" /> : <AlertTriangle className="w-4 h-4 mt-0.5" />}
          <span>
            {agrees
              ? data.ledger_check.inventory_adjustment
                ? `Agrees with the ledger after the stock adjustment of ${inr(data.ledger_check.inventory_adjustment)}.`
                : 'Agrees with the ledger.'
              : `Differs from the ledger by ${inr(data.ledger_check.difference)}. Please report this.`}
          </span>
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

export default withPageAuth('reports', 'read', ProfitLossPage);
