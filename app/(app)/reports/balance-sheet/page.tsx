'use client';

export const dynamic = 'force-dynamic';

import { PageHeader } from '@/components/layout/PageHeader';
import React, { useState, useEffect } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Loader2, Download, CheckCircle, XCircle, Printer } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { format } from 'date-fns';
import { withPageAuth } from '@/lib/auth/withPageAuth';
import { AccessDenied } from '@/components/common/AccessDenied';
import { buildApiUrl, forPdfPrintInBrowser } from '@/lib/api-helpers';

interface BsAccount {
  id: string;
  account_code: string;
  account_name: string;
  is_active?: boolean;
  balance: number;
}

interface BsSection {
  accounts: BsAccount[];
  total: number;
}

interface BalanceSheetData {
  as_on_date: string;
  financial_year?: string | null;
  financial_year_start?: string;
  inventory_model?: 'periodic' | 'perpetual';
  assets: {
    current: BsSection & { inventory_adjustment?: number };
    fixed: BsSection & { gross_block: number; accumulated_depreciation: number; net_block: number };
    investments: BsSection;
    other: BsSection;
    total: number;
  };
  liabilities: {
    current: BsSection;
    long_term: BsSection;
    other: BsSection;
    total: number;
  };
  equity: {
    capital: BsSection;
    retained_earnings: { opening: number; current_year_profit: number; closing: number };
    total: number;
  };
  total_liabilities_and_equity: number;
  difference?: number;
  is_balanced: boolean;
  abnormal_balances?: Array<{ account_code: string; account_name: string; amount: number }>;
  registers?: {
    fixed_assets: { net_block: number; assets: Array<{ asset_id: string; asset_code: string; asset_name: string; net_block: number }> } | null;
  };
}

const inr = (n: number) => Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function Money({ value, testId, bold }: { value: number; testId?: string; bold?: boolean }) {
  const neg = value < -0.004;
  return (
    <span
      data-testid={testId}
      data-value={value}
      className={`tabular-nums ${bold ? 'font-bold' : 'font-semibold'} ${neg ? 'text-red-600' : ''}`}
    >
      {neg ? `(₹${inr(value)})` : `₹${inr(value)}`}
    </span>
  );
}

function Row({ code, label, value, testId, muted }: { code?: string; label: string; value: number; testId?: string; muted?: boolean }) {
  return (
    <div className="flex justify-between items-center py-2 border-b border-border" data-testid="bs-account-row">
      <div className={muted ? 'text-text-secondary' : ''}>
        {code && <span className="font-mono text-sm text-text-secondary mr-2">{code}</span>}
        <span>{label}</span>
      </div>
      <Money value={value} testId={testId} />
    </div>
  );
}

function Section({
  title,
  section,
  sectionKey,
  extra,
  alwaysShow,
}: {
  title: string;
  section: BsSection;
  sectionKey: string;
  extra?: React.ReactNode;
  alwaysShow?: boolean;
}) {
  const rows = section.accounts.filter((a) => Math.abs(a.balance) >= 0.005);
  if (!alwaysShow && rows.length === 0 && Math.abs(section.total) < 0.005 && !extra) return null;
  return (
    <div className="mb-4" data-testid={`bs-section-${sectionKey}`}>
      <h3 className="text-lg font-semibold text-text-primary mb-2">{title}</h3>
      <div className="space-y-0">
        {rows.map((a) => (
          <Row
            key={a.id}
            code={a.account_code}
            label={a.is_active === false ? `${a.account_name} (inactive)` : a.account_name}
            value={a.balance}
          />
        ))}
        {extra}
        <div className="flex justify-between items-center py-2 border-t-2 border-border font-bold">
          <span>Total {title}</span>
          <Money value={section.total} testId={`bs-total-${sectionKey}`} bold />
        </div>
      </div>
    </div>
  );
}

function BalanceSheetPage() {
  const { business, user } = useAuth();
  const [data, setData] = useState<BalanceSheetData | null>(null);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [asOnDate, setAsOnDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [financialYear, setFinancialYear] = useState<string>('');
  const [error, setError] = useState<{ message: string; code?: string } | null>(null);

  const getBalanceSheetPdfUrl = (forPrint: boolean) => {
    if (!business?.id) return null;
    const params: Record<string, string> = {
      business_id: business.id,
      user_id: user?.id || '',
      as_on_date: asOnDate,
      ...(financialYear && { financial_year: financialYear }),
    };
    const url = buildApiUrl('/api/reports/balance-sheet/pdf', params);
    return forPrint ? forPdfPrintInBrowser(url) : url;
  };

  const handleDownloadPdf = async () => {
    setDownloading(true);
    try {
      const url = getBalanceSheetPdfUrl(false);
      if (url) window.open(url, '_blank');
    } finally {
      setDownloading(false);
    }
  };

  /** Opens PDF in the browser (inline) so you can use the viewer’s Print. Download PDF saves the file. */
  const handlePrint = () => {
    const url = getBalanceSheetPdfUrl(true);
    if (url) window.open(url, '_blank');
  };

  useEffect(() => {
    if (business?.id) fetchBalanceSheet();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [business?.id, asOnDate, financialYear]);

  const fetchBalanceSheet = async () => {
    if (!business?.id) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        buildApiUrl('/api/reports/balance-sheet', {
          business_id: business.id,
          user_id: user?.id || '',
          as_on_date: asOnDate,
          ...(financialYear && { financial_year: financialYear }),
        })
      );
      if (res.ok) {
        setData(await res.json());
      } else {
        const errorData = await res.json().catch(() => ({ error: 'Failed to fetch balance sheet' }));
        setError({
          message: errorData.message || errorData.error || 'Failed to fetch balance sheet',
          code: errorData.code || (res.status === 403 || res.status === 401 ? 'ACCESS_DENIED' : 'FETCH_ERROR'),
        });
        if (res.status === 403 || res.status === 401) setData(null);
      }
    } catch {
      setError({ message: 'Failed to fetch balance sheet', code: 'NETWORK_ERROR' });
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
      <div className="flex items-center justify-center h-[calc(100vh-100px)]">
        <AccessDenied module="reports" action="read" details={error.message} code={error.code || 'ACCESS_DENIED'} />
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

  const re = data.equity.retained_earnings;
  const invAdj = data.assets.current.inventory_adjustment || 0;
  const difference = data.difference ?? data.assets.total - data.total_liabilities_and_equity;
  const register = data.registers?.fixed_assets;

  return (
    <div className="space-y-6">
      <PageHeader
  title="Balance Sheet"
  subtitle={<>As on {format(new Date(data.as_on_date), 'dd MMM yyyy')}</>}

  actions={
    <>
<div className="flex gap-2 no-print">
          <Button
            type="button"
            variant="secondary"
            onClick={handlePrint}
            title="Opens the PDF in this browser tab so you can print (Ctrl+P). Use Download PDF to save the file instead."
          >
            <Printer className="w-4 h-4 mr-2" />
            Print
          </Button>
          <Button onClick={handleDownloadPdf} isLoading={downloading}>
            <Download className="w-4 h-4 mr-2" />
            Download PDF
          </Button>
        </div>
    </>
  }
/>

      <Card>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <Input type="date" label="As On Date" value={asOnDate} onChange={(e) => setAsOnDate(e.target.value)} />
          <Input
            type="text"
            label="Financial Year (Optional)"
            value={financialYear}
            onChange={(e) => setFinancialYear(e.target.value)}
            placeholder="e.g., 2026-27"
          />
        </div>
      </Card>

      <Card className={data.is_balanced ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}>
        <div className="flex items-center justify-between" data-testid="bs-balance-status" data-balanced={data.is_balanced}>
          <div className="flex items-center gap-3">
            {data.is_balanced ? <CheckCircle className="w-6 h-6 text-green-600" /> : <XCircle className="w-6 h-6 text-red-600" />}
            <div>
              <p className={`font-semibold ${data.is_balanced ? 'text-green-800' : 'text-red-800'}`}>
                {data.is_balanced ? 'Balance Sheet is Balanced' : 'Balance Sheet is NOT Balanced'}
              </p>
              <p className={`text-sm ${data.is_balanced ? 'text-green-700' : 'text-red-700'}`}>
                Assets: ₹{inr(data.assets.total)} | Liabilities + Equity: ₹{inr(data.total_liabilities_and_equity)}
              </p>
            </div>
          </div>
          {!data.is_balanced && <p className="text-red-600 font-semibold">Difference: ₹{inr(difference)}</p>}
        </div>
      </Card>

      {data.abnormal_balances && data.abnormal_balances.length > 0 && (
        <Card className="bg-amber-50 border-amber-200">
          <p className="font-semibold text-amber-800 mb-1">Accounts with an unusual balance</p>
          <ul className="text-sm text-amber-800 list-disc pl-5">
            {data.abnormal_balances.map((a) => (
              <li key={a.account_code}>
                {a.account_code} {a.account_name}: (₹{inr(a.amount)})
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <h2 className="text-xl font-bold text-text-primary mb-4">Assets</h2>
          <Section
            title="Current Assets"
            sectionKey="current-assets"
            section={data.assets.current}
            alwaysShow
            extra={
              Math.abs(invAdj) >= 0.005 ? (
                <Row label="Closing stock adjustment (periodic inventory)" value={invAdj} muted />
              ) : null
            }
          />
          <Section
            title="Fixed Assets"
            sectionKey="fixed-assets"
            section={data.assets.fixed}
            extra={
              register && register.assets.length > 0 ? (
                <div className="mt-2 pt-2 text-xs text-text-secondary">
                  Asset register net block: ₹{inr(register.net_block)}
                  {Math.abs(register.net_block - data.assets.fixed.net_block) >= 0.5 && (
                    <span className="text-amber-700"> (differs from the ledger; check postings)</span>
                  )}
                </div>
              ) : null
            }
          />
          <Section title="Investments" sectionKey="investments" section={data.assets.investments} />
          <Section title="Other Assets" sectionKey="other-assets" section={data.assets.other} />

          <div className="flex justify-between items-center py-4 border-t-2 border-border bg-slate-50 px-4 rounded-lg font-bold text-lg">
            <span>Total Assets</span>
            <Money value={data.assets.total} testId="bs-total-assets" bold />
          </div>
        </Card>

        <Card>
          <h2 className="text-xl font-bold text-text-primary mb-4">Liabilities & Equity</h2>
          <Section title="Current Liabilities" sectionKey="current-liabilities" section={data.liabilities.current} alwaysShow />
          <Section title="Long-term Liabilities" sectionKey="long-term-liabilities" section={data.liabilities.long_term} />
          <Section title="Other Liabilities" sectionKey="other-liabilities" section={data.liabilities.other} />

          <div className="flex justify-between items-center py-2 border-t-2 border-border font-bold mb-4">
            <span>Total Liabilities</span>
            <Money value={data.liabilities.total} testId="bs-total-liabilities" bold />
          </div>

          <div className="mb-4" data-testid="bs-section-equity">
            <h3 className="text-lg font-semibold text-text-primary mb-2">Equity</h3>
            {data.equity.capital.accounts
              .filter((a) => Math.abs(a.balance) >= 0.005)
              .map((a) => (
                <Row key={a.id} code={a.account_code} label={a.account_name} value={a.balance} />
              ))}
            {Math.abs(re.opening) >= 0.005 && (
              <Row label="Profit of earlier years (not yet closed)" value={re.opening} testId="bs-previous-years-profit" />
            )}
            <Row label="Current Year Earnings" value={re.current_year_profit} testId="bs-current-year-earnings" />
            <div className="flex justify-between items-center py-2 border-t-2 border-border font-bold">
              <span>Total Equity</span>
              <Money value={data.equity.total} testId="bs-total-equity" bold />
            </div>
          </div>

          <div className="flex justify-between items-center py-4 border-t-2 border-border bg-green-50 px-4 rounded-lg font-bold text-lg">
            <span>Total Liabilities & Equity</span>
            <Money value={data.total_liabilities_and_equity} testId="bs-total-liabilities-equity" bold />
          </div>
        </Card>
      </div>
    </div>
  );
}

export default withPageAuth('reports', 'read', BalanceSheetPage);
