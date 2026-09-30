'use client';

export const dynamic = 'force-dynamic';

import React, { useState, useEffect } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Loader2, Download, TrendingUp, TrendingDown, Printer, ChevronRight } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { buildApiUrl, forPdfPrintInBrowser } from '@/lib/api-helpers';
import { format } from 'date-fns';
import { withPageAuth } from '@/lib/auth/withPageAuth';
import { AccessDenied } from '@/components/common/AccessDenied';
import { MobileReportHeader } from '@/components/layout/MobileReportHeader';
import { ProfitLossDrilldownPanel, type DrillTarget } from '@/components/reports/ProfitLossDrilldownPanel';

interface PnLAccount {
  id: string;
  account_code: string;
  account_name: string;
  account_group_name: string;
  amount: number;
}

interface PnLData {
  period: {
    from_date: string;
    to_date: string;
    financial_year?: string;
  };
  income: {
    sales: {
      accounts: PnLAccount[];
      total: number;
    };
    other_income: {
      accounts: PnLAccount[];
      total: number;
    };
    total: number;
  };
  cogs?: {
    opening_stock: number;
    purchases: number;
    closing_stock: number;
    total: number;
    items?: Array<{
      item_id: string;
      item_name: string;
      quantity: number;
      unit_cost: number;
      total_value: number;
    }>;
    phase4?: {
      inventory_model: 'periodic' | 'perpetual';
    } | null;
  };
  expenses: {
    direct: {
      accounts: PnLAccount[];
      total: number;
    };
    indirect: {
      accounts: PnLAccount[];
      total: number;
      depreciation?: number;
    };
    other_expenses?: {
      accounts: PnLAccount[];
      total: number;
    };
    provisions?: {
      total: number;
      by_type?: Record<string, number>;
      details?: Array<{
        provision_id: string;
        provision_name: string;
        provision_type: string;
        balance: number;
      }>;
    };
    total: number;
  };
  gross_profit: number;
  operating_profit: number;
  profit_before_tax?: number;
  tax?: {
    current_tax: number;
    deferred_tax: number;
    total: number;
  };
  profit_after_tax?: number;
  net_profit: number;
  warnings?: Array<{ code: string; message: string; severity: 'info' | 'warn' | 'error' }>;
}

const inr = (n: number) => `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;

function DrillRow({
  onClick,
  className = '',
  children,
}: {
  onClick?: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  if (!onClick) {
    return <div className={`flex justify-between items-center ${className}`}>{children}</div>;
  }
  return (
    <button
      type="button"
      onClick={onClick}
      title="Click to see what makes up this amount"
      className={`group flex w-full justify-between items-center text-left rounded-md hover:bg-primary-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 ${className}`}
    >
      {children}
    </button>
  );
}

function DrillAmount({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <span className={`flex items-center gap-1 ${className}`}>
      {children}
      <ChevronRight className="w-4 h-4 text-text-secondary opacity-40 group-hover:opacity-100" />
    </span>
  );
}

function AccountLines({
  accounts,
  amountClass,
  onDrill,
}: {
  accounts: PnLAccount[];
  amountClass: string;
  onDrill: (t: DrillTarget) => void;
}) {
  return (
    <>
      {accounts.map((account) => (
        <DrillRow key={account.id} onClick={() => onDrill(accountTarget(account))} className="-mx-2 px-2 py-2 border-b border-border">
          <div>
            <span className="font-mono text-sm text-text-secondary mr-2">{account.account_code}</span>
            <span>{account.account_name}</span>
          </div>
          <DrillAmount className={`font-semibold ${amountClass}`}>{inr(account.amount)}</DrillAmount>
        </DrillRow>
      ))}
    </>
  );
}

function TotalLine({
  label,
  amount,
  amountClass,
  target,
  onDrill,
}: {
  label: string;
  amount: number;
  amountClass: string;
  target?: DrillTarget;
  onDrill: (t: DrillTarget) => void;
}) {
  return (
    <DrillRow onClick={target ? () => onDrill(target) : undefined} className="-mx-2 px-2 py-2 border-t-2 border-border font-bold">
      <span>{label}</span>
      {target ? (
        <DrillAmount className={amountClass}>{inr(amount)}</DrillAmount>
      ) : (
        <span className={amountClass}>{inr(amount)}</span>
      )}
    </DrillRow>
  );
}

const accountTarget = (a: PnLAccount): DrillTarget => ({
  kind: 'account',
  label: `${a.account_code} ${a.account_name}`,
  accountIds: [a.id],
});

const sectionTarget = (label: string, accounts: PnLAccount[]): DrillTarget | undefined =>
  accounts.length > 0 ? { kind: 'account', label, accountIds: accounts.map((a) => a.id) } : undefined;

function buildCogsTarget(data: PnLData): DrillTarget | undefined {
  if (!data.cogs) return undefined;
  if (data.cogs.phase4?.inventory_model === 'perpetual') {
    const cogsAccount = data.expenses.direct.accounts.find((a) => a.account_code === '5104');
    return cogsAccount ? { ...accountTarget(cogsAccount), label: 'Cost of Goods Sold' } : undefined;
  }
  return {
    kind: 'breakdown',
    label: 'Cost of Goods Sold',
    total: data.cogs.total,
    rows: [
      { label: 'Opening Stock', amount: data.cogs.opening_stock, sign: 1, target: { kind: 'opening_stock', label: 'Opening Stock' } },
      { label: 'Purchases', amount: data.cogs.purchases, sign: 1, target: { kind: 'purchases', label: 'Purchases' } },
      { label: 'Closing Stock', amount: data.cogs.closing_stock, sign: -1, target: { kind: 'closing_stock', label: 'Closing Stock' } },
    ],
  };
}

function buildGrossProfitTarget(data: PnLData): DrillTarget {
  const incomeAccounts = [...data.income.sales.accounts, ...data.income.other_income.accounts];
  const costUsed = data.income.total - data.gross_profit;
  const usesDirectAccounts = Math.abs(costUsed - data.expenses.direct.total) < 0.01;
  const costRows = usesDirectAccounts
    ? data.expenses.direct.accounts
        .filter((a) => Math.abs(a.amount) > 0.004)
        .map((a) => ({ label: `${a.account_code} ${a.account_name}`, amount: a.amount, sign: -1 as const, target: accountTarget(a) }))
    : [{ label: 'Cost of Goods Sold', amount: costUsed, sign: -1 as const, target: buildCogsTarget(data) }];
  const hiddenDirect =
    data.cogs && usesDirectAccounts
      ? data.expenses.direct.accounts.filter((a) => a.account_code !== '5104' && Math.abs(a.amount) > 0.004)
      : [];

  return {
    kind: 'breakdown',
    label: 'Gross Profit',
    total: data.gross_profit,
    note:
      hiddenDirect.length > 0
        ? `Gross profit deducts every direct-expense account, including ${hiddenDirect
            .map((a) => a.account_name)
            .join(', ')}, which is not listed in the Cost of Goods Sold schedule.`
        : undefined,
    rows: [
      ...incomeAccounts
        .filter((a) => Math.abs(a.amount) > 0.004)
        .map((a) => ({ label: `${a.account_code} ${a.account_name}`, amount: a.amount, sign: 1 as const, target: accountTarget(a) })),
      ...costRows,
    ],
  };
}

function buildOperatingProfitTarget(data: PnLData): DrillTarget {
  const depreciation = data.expenses.indirect.depreciation ?? 0;
  return {
    kind: 'breakdown',
    label: 'Operating Profit',
    total: data.operating_profit,
    rows: [
      { label: 'Gross Profit', amount: data.gross_profit, sign: 1, target: buildGrossProfitTarget(data) },
      ...data.expenses.indirect.accounts
        .filter((a) => Math.abs(a.amount) > 0.004)
        .map((a) => ({ label: `${a.account_code} ${a.account_name}`, amount: a.amount, sign: -1 as const, target: accountTarget(a) })),
      ...(depreciation > 0 ? [{ label: 'Depreciation', amount: depreciation, sign: -1 as const }] : []),
    ],
  };
}

function buildNetProfitTarget(data: PnLData): DrillTarget {
  const otherAccounts = data.expenses.other_expenses?.accounts ?? [];
  const net = data.profit_after_tax ?? data.net_profit;
  return {
    kind: 'breakdown',
    label: 'Net Profit',
    total: net,
    rows: [
      { label: 'Operating Profit', amount: data.operating_profit, sign: 1, target: buildOperatingProfitTarget(data) },
      ...otherAccounts
        .filter((a) => Math.abs(a.amount) > 0.004)
        .map((a) => ({ label: `${a.account_code} ${a.account_name}`, amount: a.amount, sign: -1 as const, target: accountTarget(a) })),
      ...(data.tax && Math.abs(data.tax.total) > 0.004 ? [{ label: 'Tax', amount: data.tax.total, sign: -1 as const }] : []),
    ],
  };
}

function ProfitLossPage() {
  const { business, user } = useAuth();
  const [drill, setDrill] = useState<DrillTarget | null>(null);
  const [data, setData] = useState<PnLData | null>(null);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<{ message: string; code?: string } | null>(null);
  const [fromDate, setFromDate] = useState(() => {
    const now = new Date();
    const currentYear = now.getFullYear();
    const fyStart = new Date(currentYear, 3, 1); // April 1
    return now < fyStart 
      ? format(new Date(currentYear - 1, 3, 1), 'yyyy-MM-dd')
      : format(fyStart, 'yyyy-MM-dd');
  });
  const [toDate, setToDate] = useState(format(new Date(), 'yyyy-MM-dd'));

  const getProfitLossPdfUrl = (forPrint: boolean) => {
    if (!business?.id) return null;
    const params: Record<string, string> = {
      business_id: business.id,
      user_id: user?.id || '',
      from_date: fromDate,
      to_date: toDate,
    };
    const url = buildApiUrl('/api/reports/profit-loss/pdf', params);
    return forPrint ? forPdfPrintInBrowser(url) : url;
  };

  const handleDownloadPdf = async () => {
    setDownloading(true);
    try {
      const url = getProfitLossPdfUrl(false);
      if (url) window.open(url, '_blank');
    } catch (error) {
      console.error('Error downloading PDF:', error);
    } finally {
      setDownloading(false);
    }
  };

  const handlePrint = () => {
    const url = getProfitLossPdfUrl(true);
    if (url) window.open(url, '_blank');
  };

  useEffect(() => {
    if (business?.id) {
      fetchPnL();
    }
  }, [business?.id, fromDate, toDate]);

  const fetchPnL = async () => {
    if (!business?.id) return;

    setLoading(true);
    setError(null); // Clear previous errors
    try {
      // buildApiUrl automatically includes branch_id from global context
      const params: Record<string, string> = {
        business_id: business.id,
        user_id: user?.id || '', // Required for authorization
        from_date: fromDate,
        to_date: toDate,
      };

      const res = await fetch(buildApiUrl('/api/reports/profit-loss', params));
      if (res.ok) {
        const result = await res.json();
        setData(result);
      } else {
        const errorData = await res.json().catch(() => ({ error: 'Failed to fetch profit & loss report' }));
        if (res.status === 403 || res.status === 401) {
          setError({
            message: errorData.message || errorData.error || 'Access denied',
            code: errorData.code || 'ACCESS_DENIED'
          });
          setData(null); // Clear data on access denied
        } else {
          setError({
            message: errorData.message || errorData.error || 'Failed to fetch profit & loss report',
            code: errorData.code || 'FETCH_ERROR'
          });
        }
      }
    } catch (error) {
      console.error('Error fetching P&L:', error);
      setError({
        message: 'Failed to fetch profit & loss report',
        code: 'NETWORK_ERROR'
      });
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
          <AccessDenied
            module="reports"
            action="read"
            details={error.message}
            code={error.code || "ACCESS_DENIED"}
          />
        </div>
      
    );
  }

  if (!data) {
    return (
      
        <div className="text-center py-12">
          <p className="text-text-secondary">No data available</p>
        </div>
      
    );
  }

  return (
    
      <div className="space-y-4 md:space-y-6">
        <MobileReportHeader
          title="Profit & Loss Statement"
          subtitle={`${format(new Date(data.period.from_date), 'dd MMM yyyy')} to ${format(new Date(data.period.to_date), 'dd MMM yyyy')}`}
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
              <Button size="sm" onClick={handleDownloadPdf} isLoading={downloading}>
                <Download className="w-4 h-4 md:mr-2" />
                <span className="hidden md:inline">Download PDF</span>
              </Button>
            </>
          }
        />

        <Card>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <Input
              type="date"
              label="From Date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
            />
            <Input
              type="date"
              label="To Date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
            />
          </div>
        </Card>

        {/* PHASE-4: cross-FY warning banner (and any other future warnings) */}
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
          <div className="space-y-8">
            {/* Income Section */}
            <div>
              <h2 className="text-xl font-bold text-text-primary mb-4">Income</h2>
              
              {/* Sales */}
              <div className="mb-4">
                <h3 className="text-lg font-semibold text-text-primary mb-2">Sales</h3>
                <div className="space-y-2">
                  <AccountLines accounts={data.income.sales.accounts} amountClass="text-green-600" onDrill={setDrill} />
                  <TotalLine
                    label="Total Sales"
                    amount={data.income.sales.total}
                    amountClass="text-green-600"
                    target={sectionTarget('Total Sales', data.income.sales.accounts)}
                    onDrill={setDrill}
                  />
                </div>
              </div>

              {/* Other Income */}
              {data.income.other_income.accounts.length > 0 && (
                <div className="mb-4">
                  <h3 className="text-lg font-semibold text-text-primary mb-2">Other Income</h3>
                  <div className="space-y-2">
                    <AccountLines accounts={data.income.other_income.accounts} amountClass="text-green-600" onDrill={setDrill} />
                    <TotalLine
                      label="Total Other Income"
                      amount={data.income.other_income.total}
                      amountClass="text-green-600"
                      target={sectionTarget('Total Other Income', data.income.other_income.accounts)}
                      onDrill={setDrill}
                    />
                  </div>
                </div>
              )}

              <DrillRow
                onClick={() =>
                  setDrill(
                    sectionTarget('Total Income', [...data.income.sales.accounts, ...data.income.other_income.accounts]) ?? null
                  )
                }
                className="py-3 border-t-2 border-border bg-green-50 px-4 rounded-lg font-bold text-lg"
              >
                <span>Total Income</span>
                <DrillAmount className="text-green-600">{inr(data.income.total)}</DrillAmount>
              </DrillRow>
            </div>

            {/* COGS Section */}
            {data.cogs && (
              <div>
                <h2 className="text-xl font-bold text-text-primary mb-4">Cost of Goods Sold (COGS)</h2>
                <div className="space-y-2">
                  <DrillRow
                    onClick={() => setDrill({ kind: 'opening_stock', label: 'Opening Stock' })}
                    className="-mx-2 px-2 py-2 border-b border-border"
                  >
                    <span>Opening Stock</span>
                    <DrillAmount className="font-semibold text-red-600">{inr(data.cogs.opening_stock)}</DrillAmount>
                  </DrillRow>
                  <DrillRow
                    onClick={() => setDrill({ kind: 'purchases', label: 'Purchases' })}
                    className="-mx-2 px-2 py-2 border-b border-border"
                  >
                    <span>Add: Purchases</span>
                    <DrillAmount className="font-semibold text-red-600">{inr(data.cogs.purchases)}</DrillAmount>
                  </DrillRow>
                  <DrillRow
                    onClick={() => setDrill({ kind: 'closing_stock', label: 'Closing Stock' })}
                    className="-mx-2 px-2 py-2 border-b border-border"
                  >
                    <span>Less: Closing Stock</span>
                    <DrillAmount className="font-semibold text-green-600">({inr(data.cogs.closing_stock)})</DrillAmount>
                  </DrillRow>
                  <TotalLine
                    label="Cost of Goods Sold"
                    amount={data.cogs.total}
                    amountClass="text-red-600"
                    target={buildCogsTarget(data)}
                    onDrill={setDrill}
                  />
                </div>
              </div>
            )}

            {/* Direct Expenses (if COGS not available) */}
            {!data.cogs && (
              <div>
                <h2 className="text-xl font-bold text-text-primary mb-4">Direct Expenses</h2>
                <div className="space-y-2">
                  <AccountLines accounts={data.expenses.direct.accounts} amountClass="text-red-600" onDrill={setDrill} />
                  <TotalLine
                    label="Total Direct Expenses"
                    amount={data.expenses.direct.total}
                    amountClass="text-red-600"
                    target={sectionTarget('Total Direct Expenses', data.expenses.direct.accounts)}
                    onDrill={setDrill}
                  />
                </div>
              </div>
            )}

            {/* Gross Profit */}
            <DrillRow
              onClick={() => setDrill(buildGrossProfitTarget(data))}
              className="py-4 border-t-2 border-b-2 border-border bg-slate-50 px-4 rounded-lg font-bold text-lg"
            >
              <span>Gross Profit</span>
              <DrillAmount className={data.gross_profit >= 0 ? 'text-green-600' : 'text-red-600'}>
                {inr(data.gross_profit)}
              </DrillAmount>
            </DrillRow>

            {/* Indirect Expenses */}
            <div>
              <h2 className="text-xl font-bold text-text-primary mb-4">Indirect Expenses</h2>
              <div className="space-y-2">
                <AccountLines accounts={data.expenses.indirect.accounts} amountClass="text-red-600" onDrill={setDrill} />
                {data.expenses.indirect.depreciation !== undefined && data.expenses.indirect.depreciation > 0 && (
                  <div className="flex justify-between items-center py-2 border-b border-border">
                    <span>Depreciation</span>
                    <span className="font-semibold text-red-600">
                      ₹{data.expenses.indirect.depreciation.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                )}
                <TotalLine
                  label="Total Indirect Expenses"
                  amount={data.expenses.indirect.total}
                  amountClass="text-red-600"
                  target={sectionTarget('Total Indirect Expenses', data.expenses.indirect.accounts)}
                  onDrill={setDrill}
                />
              </div>
            </div>

            {/* Other Expenses */}
            {data.expenses.other_expenses && data.expenses.other_expenses.accounts.length > 0 && (
              <div>
                <h2 className="text-xl font-bold text-text-primary mb-4">Other Expenses</h2>
                <div className="space-y-2">
                  <AccountLines accounts={data.expenses.other_expenses.accounts} amountClass="text-red-600" onDrill={setDrill} />
                  <TotalLine
                    label="Total Other Expenses"
                    amount={data.expenses.other_expenses.total}
                    amountClass="text-red-600"
                    target={sectionTarget('Total Other Expenses', data.expenses.other_expenses.accounts)}
                    onDrill={setDrill}
                  />
                </div>
              </div>
            )}

            {/* Provisions */}
            {data.expenses.provisions && data.expenses.provisions.total > 0 && (
              <div>
                <h2 className="text-xl font-bold text-text-primary mb-4">Provisions</h2>
                <div className="space-y-2">
                  {data.expenses.provisions.details?.map((provision) => (
                    <div key={provision.provision_id} className="flex justify-between items-center py-2 border-b border-border">
                      <span>{provision.provision_name}</span>
                      <span className="font-semibold text-red-600">
                        ₹{provision.balance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                  ))}
                  <div className="flex justify-between items-center py-2 border-t-2 border-border font-bold">
                    <span>Total Provisions</span>
                    <span className="text-red-600">
                      ₹{data.expenses.provisions.total.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Operating Profit */}
            <DrillRow
              onClick={() => setDrill(buildOperatingProfitTarget(data))}
              className="py-4 border-t-2 border-b-2 border-border bg-yellow-50 px-4 rounded-lg font-bold text-lg"
            >
              <span>Operating Profit</span>
              <DrillAmount className={data.operating_profit >= 0 ? 'text-green-600' : 'text-red-600'}>
                {inr(data.operating_profit)}
              </DrillAmount>
            </DrillRow>

            {/* Profit Before Tax */}
            {data.profit_before_tax !== undefined && (
              <div className="flex justify-between items-center py-4 border-t-2 border-b-2 border-border bg-slate-50 px-4 rounded-lg font-bold text-lg">
                <span>Profit Before Tax</span>
                <span className={data.profit_before_tax >= 0 ? 'text-green-600' : 'text-red-600'}>
                  ₹{data.profit_before_tax.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </span>
              </div>
            )}

            {/* Tax */}
            {data.tax && (
              <div>
                <h2 className="text-xl font-bold text-text-primary mb-4">Tax</h2>
                <div className="space-y-2">
                  <div className="flex justify-between items-center py-2 border-b border-border">
                    <span>Current Tax</span>
                    <span className="font-semibold text-red-600">
                      ₹{data.tax.current_tax.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                  {data.tax.deferred_tax > 0 && (
                    <div className="flex justify-between items-center py-2 border-b border-border">
                      <span>Deferred Tax</span>
                      <span className="font-semibold text-red-600">
                        ₹{data.tax.deferred_tax.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between items-center py-2 border-t-2 border-border font-bold">
                    <span>Total Tax</span>
                    <span className="text-red-600">
                      ₹{data.tax.total.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Profit After Tax */}
            <DrillRow
              onClick={() => setDrill(buildNetProfitTarget(data))}
              className="py-4 border-t-2 border-border bg-gray-100 px-4 rounded-lg font-bold text-xl"
            >
              <span>Profit After Tax / Net Profit</span>
              <DrillAmount className={(data.profit_after_tax ?? data.net_profit) >= 0 ? 'text-green-600' : 'text-red-600'}>
                {(data.profit_after_tax ?? data.net_profit) >= 0 ? <TrendingUp className="w-5 h-5 inline mr-2" /> : <TrendingDown className="w-5 h-5 inline mr-2" />}
                {inr(data.profit_after_tax ?? data.net_profit)}
              </DrillAmount>
            </DrillRow>
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
