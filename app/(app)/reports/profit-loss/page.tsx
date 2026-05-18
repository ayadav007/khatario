'use client';

export const dynamic = 'force-dynamic';

import React, { useState, useEffect } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Loader2, FileText, Download, TrendingUp, TrendingDown, Printer } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { buildApiUrl, forPdfPrintInBrowser } from '@/lib/api-helpers';
import { format } from 'date-fns';
import { withPageAuth } from '@/lib/auth/withPageAuth';
import { AccessDenied } from '@/components/common/AccessDenied';

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

function ProfitLossPage() {
  const { business, user } = useAuth();
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
    
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-text-primary">Profit & Loss Statement</h1>
            <p className="text-sm text-text-secondary mt-1">
              {format(new Date(data.period.from_date), 'dd MMM yyyy')} to {format(new Date(data.period.to_date), 'dd MMM yyyy')}
            </p>
          </div>
          <div className="flex gap-2 no-print">
            <Button
              type="button"
              variant="secondary"
              onClick={handlePrint}
              title="Opens the PDF in a tab for printing (Ctrl+P). Use Download PDF to save the file."
            >
              <Printer className="w-4 h-4 mr-2" />
              Print
            </Button>
            <Button onClick={handleDownloadPdf} isLoading={downloading}>
              <Download className="w-4 h-4 mr-2" />
              Download PDF
            </Button>
          </div>
        </div>

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
                  {data.income.sales.accounts.map((account) => (
                    <div key={account.id} className="flex justify-between items-center py-2 border-b border-border">
                      <div>
                        <span className="font-mono text-sm text-text-secondary mr-2">{account.account_code}</span>
                        <span>{account.account_name}</span>
                      </div>
                      <span className="font-semibold text-green-600">
                        ₹{account.amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                  ))}
                  <div className="flex justify-between items-center py-2 border-t-2 border-border font-bold">
                    <span>Total Sales</span>
                    <span className="text-green-600">
                      ₹{data.income.sales.total.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                </div>
              </div>

              {/* Other Income */}
              {data.income.other_income.accounts.length > 0 && (
                <div className="mb-4">
                  <h3 className="text-lg font-semibold text-text-primary mb-2">Other Income</h3>
                  <div className="space-y-2">
                    {data.income.other_income.accounts.map((account) => (
                      <div key={account.id} className="flex justify-between items-center py-2 border-b border-border">
                        <div>
                          <span className="font-mono text-sm text-text-secondary mr-2">{account.account_code}</span>
                          <span>{account.account_name}</span>
                        </div>
                        <span className="font-semibold text-green-600">
                          ₹{account.amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                        </span>
                      </div>
                    ))}
                    <div className="flex justify-between items-center py-2 border-t-2 border-border font-bold">
                      <span>Total Other Income</span>
                      <span className="text-green-600">
                        ₹{data.income.other_income.total.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              <div className="flex justify-between items-center py-3 border-t-2 border-border bg-green-50 px-4 rounded-lg font-bold text-lg">
                <span>Total Income</span>
                <span className="text-green-600">
                  ₹{data.income.total.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </span>
              </div>
            </div>

            {/* COGS Section */}
            {data.cogs && (
              <div>
                <h2 className="text-xl font-bold text-text-primary mb-4">Cost of Goods Sold (COGS)</h2>
                <div className="space-y-2">
                  <div className="flex justify-between items-center py-2 border-b border-border">
                    <span>Opening Stock</span>
                    <span className="font-semibold text-red-600">
                      ₹{data.cogs.opening_stock.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                  <div className="flex justify-between items-center py-2 border-b border-border">
                    <span>Add: Purchases</span>
                    <span className="font-semibold text-red-600">
                      ₹{data.cogs.purchases.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                  <div className="flex justify-between items-center py-2 border-b border-border">
                    <span>Less: Closing Stock</span>
                    <span className="font-semibold text-green-600">
                      (₹{data.cogs.closing_stock.toLocaleString('en-IN', { minimumFractionDigits: 2 })})
                    </span>
                  </div>
                  <div className="flex justify-between items-center py-2 border-t-2 border-border font-bold">
                    <span>Cost of Goods Sold</span>
                    <span className="text-red-600">
                      ₹{data.cogs.total.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Direct Expenses (if COGS not available) */}
            {!data.cogs && (
              <div>
                <h2 className="text-xl font-bold text-text-primary mb-4">Direct Expenses</h2>
                <div className="space-y-2">
                  {data.expenses.direct.accounts.map((account) => (
                    <div key={account.id} className="flex justify-between items-center py-2 border-b border-border">
                      <div>
                        <span className="font-mono text-sm text-text-secondary mr-2">{account.account_code}</span>
                        <span>{account.account_name}</span>
                      </div>
                      <span className="font-semibold text-red-600">
                        ₹{account.amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                  ))}
                  <div className="flex justify-between items-center py-2 border-t-2 border-border font-bold">
                    <span>Total Direct Expenses</span>
                    <span className="text-red-600">
                      ₹{data.expenses.direct.total.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Gross Profit */}
            <div className="flex justify-between items-center py-4 border-t-2 border-b-2 border-border bg-slate-50 px-4 rounded-lg font-bold text-lg">
              <span>Gross Profit</span>
              <span className={data.gross_profit >= 0 ? 'text-green-600' : 'text-red-600'}>
                ₹{data.gross_profit.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </span>
            </div>

            {/* Indirect Expenses */}
            <div>
              <h2 className="text-xl font-bold text-text-primary mb-4">Indirect Expenses</h2>
              <div className="space-y-2">
                {data.expenses.indirect.accounts.map((account) => (
                  <div key={account.id} className="flex justify-between items-center py-2 border-b border-border">
                    <div>
                      <span className="font-mono text-sm text-text-secondary mr-2">{account.account_code}</span>
                      <span>{account.account_name}</span>
                    </div>
                    <span className="font-semibold text-red-600">
                      ₹{account.amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                ))}
                {data.expenses.indirect.depreciation !== undefined && data.expenses.indirect.depreciation > 0 && (
                  <div className="flex justify-between items-center py-2 border-b border-border">
                    <span>Depreciation</span>
                    <span className="font-semibold text-red-600">
                      ₹{data.expenses.indirect.depreciation.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                )}
                <div className="flex justify-between items-center py-2 border-t-2 border-border font-bold">
                  <span>Total Indirect Expenses</span>
                  <span className="text-red-600">
                    ₹{data.expenses.indirect.total.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </span>
                </div>
              </div>
            </div>

            {/* Other Expenses */}
            {data.expenses.other_expenses && data.expenses.other_expenses.accounts.length > 0 && (
              <div>
                <h2 className="text-xl font-bold text-text-primary mb-4">Other Expenses</h2>
                <div className="space-y-2">
                  {data.expenses.other_expenses.accounts.map((account) => (
                    <div key={account.id} className="flex justify-between items-center py-2 border-b border-border">
                      <div>
                        <span className="font-mono text-sm text-text-secondary mr-2">{account.account_code}</span>
                        <span>{account.account_name}</span>
                      </div>
                      <span className="font-semibold text-red-600">
                        ₹{account.amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                  ))}
                  <div className="flex justify-between items-center py-2 border-t-2 border-border font-bold">
                    <span>Total Other Expenses</span>
                    <span className="text-red-600">
                      ₹{data.expenses.other_expenses.total.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
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
            <div className="flex justify-between items-center py-4 border-t-2 border-b-2 border-border bg-yellow-50 px-4 rounded-lg font-bold text-lg">
              <span>Operating Profit</span>
              <span className={data.operating_profit >= 0 ? 'text-green-600' : 'text-red-600'}>
                ₹{data.operating_profit.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </span>
            </div>

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
            <div className="flex justify-between items-center py-4 border-t-2 border-border bg-gray-100 px-4 rounded-lg font-bold text-xl">
              <span>Profit After Tax / Net Profit</span>
              <span className={(data.profit_after_tax ?? data.net_profit) >= 0 ? 'text-green-600' : 'text-red-600'}>
                {(data.profit_after_tax ?? data.net_profit) >= 0 ? <TrendingUp className="w-5 h-5 inline mr-2" /> : <TrendingDown className="w-5 h-5 inline mr-2" />}
                ₹{(data.profit_after_tax ?? data.net_profit).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </span>
            </div>
          </div>
        </Card>
      </div>
    
  );
}

export default withPageAuth('reports', 'read', ProfitLossPage);
