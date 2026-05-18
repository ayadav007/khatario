'use client';

export const dynamic = 'force-dynamic';

import React, { useState, useEffect } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Loader2, FileText, Download, TrendingUp, TrendingDown, Printer } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { format } from 'date-fns';
import { buildApiUrl, forPdfPrintInBrowser } from '@/lib/api-helpers';

interface CashFlowData {
  period: {
    from_date: string;
    to_date: string;
  };
  opening_cash_balance: number;
  operating_activities: {
    net_profit: number;
    depreciation: number;
    changes_in_working_capital: {
      receivables_increase: number;
      receivables_decrease: number;
      payables_increase: number;
      payables_decrease: number;
      inventory_increase: number;
      inventory_decrease: number;
    };
    net_cash_from_operating: number;
  };
  investing_activities: {
    fixed_asset_purchases: number;
    fixed_asset_sales: number;
    net_cash_from_investing: number;
  };
  financing_activities: {
    capital_introduced: number;
    loans_taken: number;
    net_cash_from_financing: number;
  };
  net_cash_flow: number;
  closing_cash_balance: number;
  calculated_closing_balance: number;
}

export default function CashFlowPage() {
  const { business, user } = useAuth();
  const [data, setData] = useState<CashFlowData | null>(null);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [fromDate, setFromDate] = useState(() => {
    const now = new Date();
    const currentYear = now.getFullYear();
    const fyStart = new Date(currentYear, 3, 1); // April 1
    return now < fyStart 
      ? format(new Date(currentYear - 1, 3, 1), 'yyyy-MM-dd')
      : format(fyStart, 'yyyy-MM-dd');
  });
  const [toDate, setToDate] = useState(format(new Date(), 'yyyy-MM-dd'));

  const getCashFlowPdfUrl = (forPrint: boolean) => {
    if (!business?.id) return null;
    const params: Record<string, string> = {
      business_id: business.id,
      user_id: user?.id || '',
      from_date: fromDate,
      to_date: toDate,
    };
    const url = buildApiUrl('/api/reports/cash-flow/pdf', params);
    return forPrint ? forPdfPrintInBrowser(url) : url;
  };

  const handleDownloadPdf = async () => {
    setDownloading(true);
    try {
      const url = getCashFlowPdfUrl(false);
      if (url) window.open(url, '_blank');
    } catch (error) {
      console.error('Error downloading PDF:', error);
    } finally {
      setDownloading(false);
    }
  };

  const handlePrint = () => {
    const url = getCashFlowPdfUrl(true);
    if (url) window.open(url, '_blank');
  };

  useEffect(() => {
    if (business?.id) {
      fetchCashFlow();
    }
  }, [business?.id, fromDate, toDate]);

  const fetchCashFlow = async () => {
    if (!business?.id) return;

    setLoading(true);
    try {
      const params: Record<string, string> = {
        business_id: business.id,
        user_id: user?.id || '',
        from_date: fromDate,
        to_date: toDate,
      };

      const res = await fetch(buildApiUrl('/api/reports/cash-flow', params));
      if (res.ok) {
        const result = await res.json();
        setData(result);
      }
    } catch (error) {
      console.error('Error fetching cash flow:', error);
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
            <h1 className="text-2xl font-bold text-text-primary">Cash Flow Statement</h1>
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

        <Card>
          <div className="space-y-8">
            {/* Opening Balance */}
            <div className="pb-4 border-b border-border">
              <div className="flex justify-between items-center">
                <span className="text-lg font-semibold text-text-primary">Opening Cash Balance</span>
                <span className="text-lg font-bold">
                  ₹{data.opening_cash_balance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </span>
              </div>
            </div>

            {/* Operating Activities */}
            <div>
              <h2 className="text-xl font-bold text-text-primary mb-4">Cash Flow from Operating Activities</h2>
              <div className="space-y-2">
                <div className="flex justify-between items-center py-2">
                  <span>Net Profit</span>
                  <span className={data.operating_activities.net_profit >= 0 ? 'text-green-600' : 'text-red-600'}>
                    ₹{data.operating_activities.net_profit.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </span>
                </div>
                <div className="flex justify-between items-center py-2">
                  <span className="pl-4">Add: Depreciation</span>
                  <span className="text-green-600">
                    ₹{data.operating_activities.depreciation.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </span>
                </div>
                
                {/* Working Capital Changes */}
                <div className="pl-4 mt-4">
                  <h3 className="font-semibold mb-2">Adjustments for Changes in Working Capital:</h3>
                  {data.operating_activities.changes_in_working_capital.receivables_increase > 0 && (
                    <div className="flex justify-between items-center py-1 text-sm">
                      <span className="pl-4">Increase in Receivables</span>
                      <span className="text-red-600">
                        -₹{data.operating_activities.changes_in_working_capital.receivables_increase.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                  )}
                  {data.operating_activities.changes_in_working_capital.receivables_decrease > 0 && (
                    <div className="flex justify-between items-center py-1 text-sm">
                      <span className="pl-4">Decrease in Receivables</span>
                      <span className="text-green-600">
                        +₹{data.operating_activities.changes_in_working_capital.receivables_decrease.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                  )}
                  {data.operating_activities.changes_in_working_capital.payables_increase > 0 && (
                    <div className="flex justify-between items-center py-1 text-sm">
                      <span className="pl-4">Increase in Payables</span>
                      <span className="text-green-600">
                        +₹{data.operating_activities.changes_in_working_capital.payables_increase.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                  )}
                  {data.operating_activities.changes_in_working_capital.payables_decrease > 0 && (
                    <div className="flex justify-between items-center py-1 text-sm">
                      <span className="pl-4">Decrease in Payables</span>
                      <span className="text-red-600">
                        -₹{data.operating_activities.changes_in_working_capital.payables_decrease.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                  )}
                  {data.operating_activities.changes_in_working_capital.inventory_increase > 0 && (
                    <div className="flex justify-between items-center py-1 text-sm">
                      <span className="pl-4">Increase in Inventory</span>
                      <span className="text-red-600">
                        -₹{data.operating_activities.changes_in_working_capital.inventory_increase.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                  )}
                  {data.operating_activities.changes_in_working_capital.inventory_decrease > 0 && (
                    <div className="flex justify-between items-center py-1 text-sm">
                      <span className="pl-4">Decrease in Inventory</span>
                      <span className="text-green-600">
                        +₹{data.operating_activities.changes_in_working_capital.inventory_decrease.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                  )}
                </div>

                <div className="flex justify-between items-center py-3 border-t-2 border-border font-bold text-lg">
                  <span>Net Cash from Operating Activities</span>
                  <span className={data.operating_activities.net_cash_from_operating >= 0 ? 'text-green-600' : 'text-red-600'}>
                    ₹{data.operating_activities.net_cash_from_operating.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </span>
                </div>
              </div>
            </div>

            {/* Investing Activities */}
            <div>
              <h2 className="text-xl font-bold text-text-primary mb-4">Cash Flow from Investing Activities</h2>
              <div className="space-y-2">
                {data.investing_activities.fixed_asset_purchases > 0 && (
                  <div className="flex justify-between items-center py-2">
                    <span>Purchase of Fixed Assets</span>
                    <span className="text-red-600">
                      -₹{data.investing_activities.fixed_asset_purchases.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                )}
                {data.investing_activities.fixed_asset_sales > 0 && (
                  <div className="flex justify-between items-center py-2">
                    <span>Sale of Fixed Assets</span>
                    <span className="text-green-600">
                      +₹{data.investing_activities.fixed_asset_sales.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                )}
                <div className="flex justify-between items-center py-3 border-t-2 border-border font-bold text-lg">
                  <span>Net Cash from Investing Activities</span>
                  <span className={data.investing_activities.net_cash_from_investing >= 0 ? 'text-green-600' : 'text-red-600'}>
                    ₹{data.investing_activities.net_cash_from_investing.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </span>
                </div>
              </div>
            </div>

            {/* Financing Activities */}
            <div>
              <h2 className="text-xl font-bold text-text-primary mb-4">Cash Flow from Financing Activities</h2>
              <div className="space-y-2">
                {data.financing_activities.capital_introduced > 0 && (
                  <div className="flex justify-between items-center py-2">
                    <span>Capital Introduced</span>
                    <span className="text-green-600">
                      +₹{data.financing_activities.capital_introduced.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                )}
                {data.financing_activities.loans_taken > 0 && (
                  <div className="flex justify-between items-center py-2">
                    <span>Loans Taken</span>
                    <span className="text-green-600">
                      +₹{data.financing_activities.loans_taken.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                )}
                <div className="flex justify-between items-center py-3 border-t-2 border-border font-bold text-lg">
                  <span>Net Cash from Financing Activities</span>
                  <span className={data.financing_activities.net_cash_from_financing >= 0 ? 'text-green-600' : 'text-red-600'}>
                    ₹{data.financing_activities.net_cash_from_financing.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </span>
                </div>
              </div>
            </div>

            {/* Net Cash Flow */}
            <div className="flex justify-between items-center py-4 border-t-2 border-b-2 border-border bg-slate-50 px-4 rounded-lg font-bold text-lg">
              <span>Net Increase/Decrease in Cash</span>
              <span className={data.net_cash_flow >= 0 ? 'text-green-600' : 'text-red-600'}>
                {data.net_cash_flow >= 0 ? <TrendingUp className="w-5 h-5 inline mr-2" /> : <TrendingDown className="w-5 h-5 inline mr-2" />}
                ₹{data.net_cash_flow.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </span>
            </div>

            {/* Closing Balance */}
            <div className="flex justify-between items-center py-4 border-t-2 border-border bg-gray-100 px-4 rounded-lg font-bold text-xl">
              <span>Closing Cash Balance</span>
              <span>
                ₹{data.closing_cash_balance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </span>
            </div>
          </div>
        </Card>
      </div>
    
  );
}

