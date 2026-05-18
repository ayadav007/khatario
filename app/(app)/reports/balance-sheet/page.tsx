'use client';

export const dynamic = 'force-dynamic';

import React, { useState, useEffect } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Loader2, FileText, Download, CheckCircle, XCircle, Printer } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { format } from 'date-fns';
import { withPageAuth } from '@/lib/auth/withPageAuth';
import { AccessDenied } from '@/components/common/AccessDenied';
import { buildApiUrl, forPdfPrintInBrowser } from '@/lib/api-helpers';

interface BalanceSheetAccount {
  id: string;
  account_code: string;
  account_name: string;
  account_group_name: string;
  balance: number;
}

interface BalanceSheetData {
  as_on_date: string;
  financial_year?: string;
  assets: {
    current: {
      accounts: BalanceSheetAccount[];
      inventory?: number;
      receivables?: number;
      prepaid_expenses?: number;
      accrued_income?: number;
      advances_to_suppliers?: number;
      loans_and_advances?: number;
      total: number;
    };
    fixed: {
      gross_block?: number;
      accumulated_depreciation?: number;
      net_block?: number;
      assets?: Array<{
        asset_id: string;
        asset_code: string;
        asset_name: string;
        purchase_cost: number;
        accumulated_depreciation: number;
        net_block: number;
      }>;
      total: number;
    };
    investments: { accounts: BalanceSheetAccount[]; total: number };
    total: number;
  };
  liabilities: {
    current: {
      accounts: BalanceSheetAccount[];
      payables?: number;
      outstanding_expenses?: number;
      accrued_expenses?: number;
      advances_from_customers?: number;
      unearned_revenue?: number;
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
      tax_payable?: {
        current_tax: number;
        deferred_tax: number;
        total: number;
      };
      total: number;
    };
    long_term: { accounts: BalanceSheetAccount[]; total: number };
    total: number;
  };
  equity: {
    capital: { accounts: BalanceSheetAccount[]; total: number };
    retained_earnings: {
      opening?: number;
      current_year_profit?: number;
      dividends?: number;
      closing: number;
    } | number;
    total: number;
  };
  deferred_tax?: {
    assets: number;
    liabilities: number;
  };
  total_liabilities_and_equity: number;
  is_balanced: boolean;
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
    } catch (error) {
      console.error('Error downloading PDF:', error);
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
    if (business?.id) {
      fetchBalanceSheet();
    }
  }, [business?.id, asOnDate, financialYear]);

  const fetchBalanceSheet = async () => {
    if (!business?.id) return;

    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        business_id: business.id,
        user_id: user?.id || '', // Required for authorization
        as_on_date: asOnDate,
        ...(financialYear && { financial_year: financialYear }),
      });

      const res = await fetch(`/api/reports/balance-sheet?${params}`);
      
      if (res.ok) {
        const result = await res.json();
        setData(result);
      } else {
        // Handle authorization and other errors
        const errorData = await res.json().catch(() => ({ error: 'Failed to fetch balance sheet' }));
        
        if (res.status === 403 || res.status === 401) {
          setError({
            message: errorData.message || errorData.error || 'Access denied',
            code: errorData.code || 'ACCESS_DENIED'
          });
          setData(null);
        } else {
          setError({
            message: errorData.message || errorData.error || 'Failed to fetch balance sheet',
            code: errorData.code || 'FETCH_ERROR'
          });
        }
      }
    } catch (error) {
      console.error('Error fetching balance sheet:', error);
      setError({
        message: 'Failed to fetch balance sheet',
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
      
        <div className="flex items-center justify-center h-[calc(100vh-100px)]">
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
            <h1 className="text-2xl font-bold text-text-primary">Balance Sheet</h1>
            <p className="text-sm text-text-secondary mt-1">
              As on {format(new Date(data.as_on_date), 'dd MMM yyyy')}
            </p>
          </div>
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
        </div>

        <Card>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <Input
              type="date"
              label="As On Date"
              value={asOnDate}
              onChange={(e) => setAsOnDate(e.target.value)}
            />
            <Input
              type="text"
              label="Financial Year (Optional)"
              value={financialYear}
              onChange={(e) => setFinancialYear(e.target.value)}
              placeholder="e.g., 2024-2025"
            />
          </div>
        </Card>

        {/* Balance Status */}
        <Card className={data.is_balanced ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {data.is_balanced ? (
                <CheckCircle className="w-6 h-6 text-green-600" />
              ) : (
                <XCircle className="w-6 h-6 text-red-600" />
              )}
              <div>
                <p className={`font-semibold ${data.is_balanced ? 'text-green-800' : 'text-red-800'}`}>
                  {data.is_balanced ? 'Balance Sheet is Balanced' : 'Balance Sheet is NOT Balanced'}
                </p>
                <p className={`text-sm ${data.is_balanced ? 'text-green-700' : 'text-red-700'}`}>
                  Assets: ₹{data.assets.total.toLocaleString('en-IN', { minimumFractionDigits: 2 })} | 
                  Liabilities + Equity: ₹{data.total_liabilities_and_equity.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </p>
              </div>
            </div>
            {!data.is_balanced && (
              <p className="text-red-600 font-semibold">
                Difference: ₹{Math.abs(data.assets.total - data.total_liabilities_and_equity).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </p>
            )}
          </div>
        </Card>

        {/* Balance Sheet */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Assets Side */}
          <Card>
            <h2 className="text-xl font-bold text-text-primary mb-4">Assets</h2>
            
            {/* Current Assets */}
            <div className="mb-4">
              <h3 className="text-lg font-semibold text-text-primary mb-2">Current Assets</h3>
              <div className="space-y-2">
                {data.assets.current.inventory !== undefined && data.assets.current.inventory > 0 && (
                  <div className="flex justify-between items-center py-2 border-b border-border">
                    <span>Inventory (Closing Stock)</span>
                    <span className="font-semibold">
                      ₹{data.assets.current.inventory.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                )}
                {data.assets.current.receivables !== undefined && data.assets.current.receivables > 0 && (
                  <div className="flex justify-between items-center py-2 border-b border-border">
                    <span>Accounts Receivable</span>
                    <span className="font-semibold">
                      ₹{data.assets.current.receivables.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                )}
                {data.assets.current.prepaid_expenses !== undefined && data.assets.current.prepaid_expenses > 0 && (
                  <div className="flex justify-between items-center py-2 border-b border-border">
                    <span>Prepaid Expenses</span>
                    <span className="font-semibold">
                      ₹{data.assets.current.prepaid_expenses.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                )}
                {data.assets.current.accrued_income !== undefined && data.assets.current.accrued_income > 0 && (
                  <div className="flex justify-between items-center py-2 border-b border-border">
                    <span>Accrued Income</span>
                    <span className="font-semibold">
                      ₹{data.assets.current.accrued_income.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                )}
                {data.assets.current.advances_to_suppliers !== undefined && data.assets.current.advances_to_suppliers > 0 && (
                  <div className="flex justify-between items-center py-2 border-b border-border">
                    <span>Advances to Suppliers</span>
                    <span className="font-semibold">
                      ₹{data.assets.current.advances_to_suppliers.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                )}
                {data.assets.current.loans_and_advances !== undefined && data.assets.current.loans_and_advances > 0 && (
                  <div className="flex justify-between items-center py-2 border-b border-border">
                    <span>Loans and Advances</span>
                    <span className="font-semibold">
                      ₹{data.assets.current.loans_and_advances.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                )}
                {(data.assets.current as any).accounts?.map((account: any) => {
                  // Skip accounts already shown in detail
                  if (account.account_code === '1104' && data.assets.current.inventory !== undefined) return null;
                  if (account.account_code === '1103' && data.assets.current.receivables !== undefined) return null;
                  if (account.account_code === '1105' && data.assets.current.prepaid_expenses !== undefined) return null;
                  if (account.account_code === '1106' && data.assets.current.accrued_income !== undefined) return null;
                  if (account.account_code === '1107' && data.assets.current.advances_to_suppliers !== undefined) return null;
                  if (account.account_code === '1108' && data.assets.current.loans_and_advances !== undefined) return null;
                  
                  return account.balance > 0 ? (
                    <div key={account.id} className="flex justify-between items-center py-2 border-b border-border">
                      <div>
                        <span className="font-mono text-sm text-text-secondary mr-2">{account.account_code}</span>
                        <span>{account.account_name}</span>
                      </div>
                      <span className="font-semibold">
                        ₹{account.balance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                  ) : null;
                })}
                <div className="flex justify-between items-center py-2 border-t-2 border-border font-bold">
                  <span>Total Current Assets</span>
                  <span>₹{data.assets.current.total.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                </div>
              </div>
            </div>

            {/* Fixed Assets */}
            <div className="mb-4">
              <h3 className="text-lg font-semibold text-text-primary mb-2">Fixed Assets</h3>
              <div className="space-y-2">
                {data.assets.fixed.gross_block !== undefined && (
                  <>
                    <div className="flex justify-between items-center py-2 border-b border-border">
                      <span>Gross Block</span>
                      <span className="font-semibold">
                        ₹{data.assets.fixed.gross_block.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                    <div className="flex justify-between items-center py-2 border-b border-border">
                      <span>Less: Accumulated Depreciation</span>
                      <span className="font-semibold text-red-600">
                        (₹{data.assets.fixed.accumulated_depreciation?.toLocaleString('en-IN', { minimumFractionDigits: 2 })})
                      </span>
                    </div>
                    <div className="flex justify-between items-center py-2 border-t-2 border-border font-bold">
                      <span>Net Block</span>
                      <span>₹{data.assets.fixed.net_block?.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                    </div>
                    {data.assets.fixed.assets && data.assets.fixed.assets.length > 0 && (
                      <div className="mt-2 pt-2 border-t border-border">
                        <p className="text-sm font-semibold mb-2">Asset Details:</p>
                        {data.assets.fixed.assets.map((asset) => (
                          <div key={asset.asset_id} className="text-xs text-text-secondary mb-1 pl-4">
                            {asset.asset_code} - {asset.asset_name}: ₹{asset.net_block.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
                {data.assets.fixed.gross_block === undefined && (data.assets.fixed as any).accounts?.map((account: any) => (
                  account.balance > 0 && (
                    <div key={account.id} className="flex justify-between items-center py-2 border-b border-border">
                      <div>
                        <span className="font-mono text-sm text-text-secondary mr-2">{account.account_code}</span>
                        <span>{account.account_name}</span>
                      </div>
                      <span className="font-semibold">
                        ₹{account.balance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                  )
                ))}
                {data.assets.fixed.gross_block === undefined && (
                  <div className="flex justify-between items-center py-2 border-t-2 border-border font-bold">
                    <span>Total Fixed Assets</span>
                    <span>₹{data.assets.fixed.total.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Investments */}
            {data.assets.investments.accounts.length > 0 && (
              <div className="mb-4">
                <h3 className="text-lg font-semibold text-text-primary mb-2">Investments</h3>
                <div className="space-y-2">
                  {(data.assets.investments as any).accounts?.map((account: any) => (
                    account.balance > 0 && (
                      <div key={account.id} className="flex justify-between items-center py-2 border-b border-border">
                        <div>
                          <span className="font-mono text-sm text-text-secondary mr-2">{account.account_code}</span>
                          <span>{account.account_name}</span>
                        </div>
                        <span className="font-semibold">
                          ₹{account.balance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                        </span>
                      </div>
                    )
                  ))}
                  <div className="flex justify-between items-center py-2 border-t-2 border-border font-bold">
                    <span>Total Investments</span>
                    <span>₹{data.assets.investments.total.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                  </div>
                </div>
              </div>
            )}

            <div className="flex justify-between items-center py-4 border-t-2 border-border bg-slate-50 px-4 rounded-lg font-bold text-lg">
              <span>Total Assets</span>
              <span>₹{data.assets.total.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
            </div>
          </Card>

          {/* Liabilities & Equity Side */}
          <Card>
            <h2 className="text-xl font-bold text-text-primary mb-4">Liabilities & Equity</h2>
            
            {/* Current Liabilities */}
            <div className="mb-4">
              <h3 className="text-lg font-semibold text-text-primary mb-2">Current Liabilities</h3>
              <div className="space-y-2">
                {data.liabilities.current.payables !== undefined && data.liabilities.current.payables > 0 && (
                  <div className="flex justify-between items-center py-2 border-b border-border">
                    <span>Accounts Payable</span>
                    <span className="font-semibold">
                      ₹{data.liabilities.current.payables.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                )}
                {data.liabilities.current.outstanding_expenses !== undefined && data.liabilities.current.outstanding_expenses > 0 && (
                  <div className="flex justify-between items-center py-2 border-b border-border">
                    <span>Outstanding Expenses</span>
                    <span className="font-semibold">
                      ₹{data.liabilities.current.outstanding_expenses.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                )}
                {data.liabilities.current.accrued_expenses !== undefined && data.liabilities.current.accrued_expenses > 0 && (
                  <div className="flex justify-between items-center py-2 border-b border-border">
                    <span>Accrued Expenses</span>
                    <span className="font-semibold">
                      ₹{data.liabilities.current.accrued_expenses.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                )}
                {data.liabilities.current.advances_from_customers !== undefined && data.liabilities.current.advances_from_customers > 0 && (
                  <div className="flex justify-between items-center py-2 border-b border-border">
                    <span>Advances from Customers</span>
                    <span className="font-semibold">
                      ₹{data.liabilities.current.advances_from_customers.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                )}
                {data.liabilities.current.unearned_revenue !== undefined && data.liabilities.current.unearned_revenue > 0 && (
                  <div className="flex justify-between items-center py-2 border-b border-border">
                    <span>Unearned Revenue</span>
                    <span className="font-semibold">
                      ₹{data.liabilities.current.unearned_revenue.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                )}
                {data.liabilities.current.provisions && data.liabilities.current.provisions.total > 0 && (
                  <div className="py-2 border-b border-border">
                    <div className="font-semibold mb-2">Provisions:</div>
                    {data.liabilities.current.provisions.details?.map((provision) => (
                      <div key={provision.provision_id} className="flex justify-between items-center py-1 pl-4 text-sm">
                        <span>{provision.provision_name}</span>
                        <span className="font-semibold">
                          ₹{provision.balance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                        </span>
                      </div>
                    ))}
                    <div className="flex justify-between items-center py-1 border-t border-border mt-1 font-semibold">
                      <span>Total Provisions</span>
                      <span>₹{data.liabilities.current.provisions.total.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                    </div>
                  </div>
                )}
                {data.liabilities.current.tax_payable && (
                  <div className="py-2 border-b border-border">
                    <div className="font-semibold mb-2">Tax Payable:</div>
                    {data.liabilities.current.tax_payable.current_tax > 0 && (
                      <div className="flex justify-between items-center py-1 pl-4 text-sm">
                        <span>Current Tax</span>
                        <span className="font-semibold">
                          ₹{data.liabilities.current.tax_payable.current_tax.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                        </span>
                      </div>
                    )}
                    {data.liabilities.current.tax_payable.deferred_tax > 0 && (
                      <div className="flex justify-between items-center py-1 pl-4 text-sm">
                        <span>Deferred Tax</span>
                        <span className="font-semibold">
                          ₹{data.liabilities.current.tax_payable.deferred_tax.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                        </span>
                      </div>
                    )}
                    <div className="flex justify-between items-center py-1 border-t border-border mt-1 font-semibold">
                      <span>Total Tax Payable</span>
                      <span>₹{data.liabilities.current.tax_payable.total.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                    </div>
                  </div>
                )}
                {(data.liabilities.current as any).accounts?.map((account: any) => {
                  // Skip accounts already shown in detail
                  if (account.account_code === '2101' && data.liabilities.current.payables !== undefined) return null;
                  if (account.account_code === '2104' && data.liabilities.current.outstanding_expenses !== undefined) return null;
                  if (account.account_code === '2105' && data.liabilities.current.accrued_expenses !== undefined) return null;
                  if (account.account_code === '2106' && data.liabilities.current.advances_from_customers !== undefined) return null;
                  if (account.account_code === '2107' && data.liabilities.current.unearned_revenue !== undefined) return null;
                  if (account.account_code === '2108' || account.account_code === '2109' || account.account_code === '2110') return null;
                  
                  return Math.abs(account.balance) > 0 ? (
                    <div key={account.id} className="flex justify-between items-center py-2 border-b border-border">
                      <div>
                        <span className="font-mono text-sm text-text-secondary mr-2">{account.account_code}</span>
                        <span>{account.account_name}</span>
                      </div>
                      <span className="font-semibold">
                        ₹{Math.abs(account.balance).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                  ) : null;
                })}
                <div className="flex justify-between items-center py-2 border-t-2 border-border font-bold">
                  <span>Total Current Liabilities</span>
                  <span>₹{data.liabilities.current.total.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                </div>
              </div>
            </div>

            {/* Long-term Liabilities */}
            {data.liabilities.long_term.accounts.length > 0 && (
              <div className="mb-4">
                <h3 className="text-lg font-semibold text-text-primary mb-2">Long-term Liabilities</h3>
                <div className="space-y-2">
                  {(data.liabilities.long_term as any).accounts?.map((account: any) => (
                    Math.abs(account.balance) > 0 && (
                      <div key={account.id} className="flex justify-between items-center py-2 border-b border-border">
                        <div>
                          <span className="font-mono text-sm text-text-secondary mr-2">{account.account_code}</span>
                          <span>{account.account_name}</span>
                        </div>
                        <span className="font-semibold">
                          ₹{Math.abs(account.balance).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                        </span>
                      </div>
                    )
                  ))}
                  <div className="flex justify-between items-center py-2 border-t-2 border-border font-bold">
                    <span>Total Long-term Liabilities</span>
                    <span>₹{data.liabilities.long_term.total.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                  </div>
                </div>
              </div>
            )}

            <div className="flex justify-between items-center py-2 border-t-2 border-border font-bold mb-4">
              <span>Total Liabilities</span>
              <span>₹{data.liabilities.total.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
            </div>

            {/* Equity */}
            <div className="mb-4">
              <h3 className="text-lg font-semibold text-text-primary mb-2">Equity</h3>
              <div className="space-y-2">
                {data.equity.capital.accounts.map((account) => (
                  Math.abs(account.balance) > 0 && (
                    <div key={account.id} className="flex justify-between items-center py-2 border-b border-border">
                      <div>
                        <span className="font-mono text-sm text-text-secondary mr-2">{account.account_code}</span>
                        <span>{account.account_name}</span>
                      </div>
                      <span className="font-semibold">
                        ₹{Math.abs(account.balance).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                  )
                ))}
                <div className="py-2 border-b border-border">
                  <div className="font-semibold mb-2">Retained Earnings:</div>
                  {typeof data.equity.retained_earnings === 'object' ? (
                    <>
                      {data.equity.retained_earnings.opening !== undefined && (
                        <div className="flex justify-between items-center py-1 pl-4 text-sm">
                          <span>Opening Balance</span>
                          <span>₹{data.equity.retained_earnings.opening.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                        </div>
                      )}
                      {data.equity.retained_earnings.current_year_profit !== undefined && (
                        <div className="flex justify-between items-center py-1 pl-4 text-sm">
                          <span>Add: Current Year Profit</span>
                          <span className={data.equity.retained_earnings.current_year_profit >= 0 ? 'text-green-600' : 'text-red-600'}>
                            ₹{data.equity.retained_earnings.current_year_profit.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                          </span>
                        </div>
                      )}
                      {data.equity.retained_earnings.dividends !== undefined && data.equity.retained_earnings.dividends > 0 && (
                        <div className="flex justify-between items-center py-1 pl-4 text-sm">
                          <span>Less: Dividends</span>
                          <span className="text-red-600">
                            (₹{data.equity.retained_earnings.dividends.toLocaleString('en-IN', { minimumFractionDigits: 2 })})
                          </span>
                        </div>
                      )}
                      <div className="flex justify-between items-center py-1 border-t border-border mt-1 font-semibold">
                        <span>Closing Retained Earnings</span>
                        <span>₹{data.equity.retained_earnings.closing.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                      </div>
                    </>
                  ) : (
                    <div className="flex justify-between items-center">
                      <span>Retained Earnings</span>
                      <span className="font-semibold">
                        ₹{data.equity.retained_earnings.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                  )}
                </div>
                <div className="flex justify-between items-center py-2 border-t-2 border-border font-bold">
                  <span>Total Equity</span>
                  <span>₹{data.equity.total.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                </div>
              </div>
            </div>

            <div className="flex justify-between items-center py-4 border-t-2 border-border bg-green-50 px-4 rounded-lg font-bold text-lg">
              <span>Total Liabilities & Equity</span>
              <span>₹{data.total_liabilities_and_equity.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
            </div>
          </Card>
        </div>
      </div>
    
  );
}

export default withPageAuth('reports', 'read', BalanceSheetPage);