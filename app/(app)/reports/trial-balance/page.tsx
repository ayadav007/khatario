'use client';

export const dynamic = 'force-dynamic';

import React, { useState, useEffect } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Loader2, FileText, Download, CheckCircle, XCircle, Printer } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { buildApiUrl, forPdfPrintInBrowser } from '@/lib/api-helpers';
import { format } from 'date-fns';

interface TrialBalanceAccount {
  account_id: string;
  account_code: string;
  account_name: string;
  account_type: string;
  account_group_name: string;
  opening_balance: number;
  debit: number;
  credit: number;
  balance: number;
}

interface TrialBalanceData {
  as_on_date: string;
  accounts: TrialBalanceAccount[];
  totals: {
    total_debit: number;
    total_credit: number;
  };
  summary_by_type: Record<string, { debit: number; credit: number; count: number }>;
  is_balanced: boolean;
}

export default function TrialBalancePage() {
  const { business, user } = useAuth();
  const [data, setData] = useState<TrialBalanceData | null>(null);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [asOnDate, setAsOnDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [financialYear, setFinancialYear] = useState<string>('');

  const getTrialBalancePdfUrl = (forPrint: boolean) => {
    if (!business?.id) return null;
    const params: Record<string, string> = {
      business_id: business.id,
      user_id: user?.id || '',
      as_on_date: asOnDate,
      ...(financialYear && { financial_year: financialYear }),
    };
    const url = buildApiUrl('/api/reports/trial-balance/pdf', params);
    return forPrint ? forPdfPrintInBrowser(url) : url;
  };

  const handleDownloadPdf = async () => {
    setDownloading(true);
    try {
      const url = getTrialBalancePdfUrl(false);
      if (url) window.open(url, '_blank');
    } catch (error) {
      console.error('Error downloading PDF:', error);
    } finally {
      setDownloading(false);
    }
  };

  const handlePrint = () => {
    const url = getTrialBalancePdfUrl(true);
    if (url) window.open(url, '_blank');
  };

  useEffect(() => {
    if (business?.id) {
      fetchTrialBalance();
    }
  }, [business?.id, asOnDate, financialYear]);

  const fetchTrialBalance = async () => {
    if (!business?.id) return;

    setLoading(true);
    try {
      // buildApiUrl automatically includes branch_id from global context
      const params: Record<string, string> = {
        business_id: business.id,
        user_id: user?.id || '', // Required for authorization
        as_on_date: asOnDate,
        ...(financialYear && { financial_year: financialYear }),
      };

      const res = await fetch(buildApiUrl('/api/reports/trial-balance', params));
      if (res.ok) {
        const result = await res.json();
        setData(result);
      }
    } catch (error) {
      console.error('Error fetching trial balance:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleExport = () => {
    if (!data) return;
    
    // Simple CSV export
    const csv = [
      ['Account Code', 'Account Name', 'Account Type', 'Debit', 'Credit'].join(','),
      ...data.accounts.map(acc => [
        acc.account_code,
        `"${acc.account_name}"`,
        acc.account_type,
        acc.debit.toFixed(2),
        acc.credit.toFixed(2),
      ].join(',')),
      ['', '', 'Total', data.totals.total_debit.toFixed(2), data.totals.total_credit.toFixed(2)].join(','),
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `trial-balance-${asOnDate}.csv`;
    a.click();
  };

  if (loading && !data) {
    return (
      
        <div className="flex items-center justify-center h-[calc(100vh-100px)]">
          <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
        </div>
      
    );
  }

  return (
    
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-text-primary">Trial Balance</h1>
            <p className="text-sm text-text-secondary mt-1">Account balances as of selected date</p>
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
            {data && (
              <Button variant="secondary" onClick={handleExport}>
                <FileText className="w-4 h-4 mr-2" />
                Export CSV
              </Button>
            )}
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

        {data && (
          <>
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
                      {data.is_balanced ? 'Trial Balance is Balanced' : 'Trial Balance is NOT Balanced'}
                    </p>
                    <p className={`text-sm ${data.is_balanced ? 'text-green-700' : 'text-red-700'}`}>
                      Debit Total: ₹{data.totals.total_debit.toLocaleString('en-IN', { minimumFractionDigits: 2 })} | 
                      Credit Total: ₹{data.totals.total_credit.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </p>
                  </div>
                </div>
                {!data.is_balanced && (
                  <p className="text-red-600 font-semibold">
                    Difference: ₹{Math.abs(data.totals.total_debit - data.totals.total_credit).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </p>
                )}
              </div>
            </Card>

            {/* Summary by Type */}
            <Card>
              <h2 className="text-lg font-semibold text-text-primary mb-4">Summary by Account Type</h2>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-3 px-4 font-semibold text-text-primary">Account Type</th>
                      <th className="text-right py-3 px-4 font-semibold text-text-primary">Count</th>
                      <th className="text-right py-3 px-4 font-semibold text-text-primary">Total Debit</th>
                      <th className="text-right py-3 px-4 font-semibold text-text-primary">Total Credit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(data.summary_by_type).map(([type, summary]) => (
                      <tr key={type} className="border-b border-border">
                        <td className="py-4 px-4 font-medium capitalize">{type}</td>
                        <td className="py-4 px-4 text-right">{summary.count}</td>
                        <td className="py-4 px-4 text-right text-primary-600">
                          ₹{summary.debit.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                        </td>
                        <td className="py-4 px-4 text-right text-green-600">
                          ₹{summary.credit.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            {/* Detailed Trial Balance */}
            <Card>
              <h2 className="text-lg font-semibold text-text-primary mb-4">Detailed Trial Balance</h2>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-3 px-4 font-semibold text-text-primary">Account Code</th>
                      <th className="text-left py-3 px-4 font-semibold text-text-primary">Account Name</th>
                      <th className="text-left py-3 px-4 font-semibold text-text-primary">Group</th>
                      <th className="text-left py-3 px-4 font-semibold text-text-primary">Type</th>
                      <th className="text-right py-3 px-4 font-semibold text-text-primary">Debit</th>
                      <th className="text-right py-3 px-4 font-semibold text-text-primary">Credit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.accounts.map((account) => (
                      <tr key={account.account_id} className="border-b border-border hover:bg-gray-50">
                        <td className="py-4 px-4 font-mono text-sm">{account.account_code}</td>
                        <td className="py-4 px-4 font-medium">{account.account_name}</td>
                        <td className="py-4 px-4 text-sm text-text-secondary">{account.account_group_name}</td>
                        <td className="py-4 px-4">
                          <span className="px-2 py-1 rounded-md text-xs bg-gray-100 text-gray-800 capitalize">
                            {account.account_type}
                          </span>
                        </td>
                        <td className="py-4 px-4 text-right">
                          {account.debit > 0 && (
                            <span className="text-primary-600">
                              ₹{account.debit.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                            </span>
                          )}
                        </td>
                        <td className="py-4 px-4 text-right">
                          {account.credit > 0 && (
                            <span className="text-green-600">
                              ₹{account.credit.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                    <tr className="border-t-2 border-border font-bold bg-gray-50">
                      <td colSpan={4} className="py-4 px-4">Total</td>
                      <td className="py-4 px-4 text-right text-primary-600">
                        ₹{data.totals.total_debit.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </td>
                      <td className="py-4 px-4 text-right text-green-600">
                        ₹{data.totals.total_credit.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </Card>
          </>
        )}
      </div>
    
  );
}

