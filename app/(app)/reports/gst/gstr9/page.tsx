'use client';

export const dynamic = 'force-dynamic';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { Download, FileText, RefreshCw, TrendingUp, TrendingDown, MinusCircle, AlertCircle } from 'lucide-react';
import { useToastContext } from '@/contexts/ToastContext';

export default function GSTR9Page() {
  const { business, user } = useAuth();
  const router = useRouter();
  const toast = useToastContext();
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<any>(null);
  const [overrides, setOverrides] = useState<any>({});
  
  // Financial year selector (e.g., 2024 for FY 2024-25)
  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth() + 1;
  // If current month is Jan-Mar, the financial year started in previous calendar year
  const defaultFY = currentMonth <= 3 ? currentYear - 1 : currentYear;
  const [financialYear, setFinancialYear] = useState(defaultFY);

  // Helper to get effective data (base + overrides)
  const getEffectiveData = () => {
    if (!data) return null;
    // Deep clone base data then apply overrides
    const effective = JSON.parse(JSON.stringify(data));
    
    // Apply overrides logic here if needed for export
    // For UI, we'll handle overrides per component
    return effective;
  };

  const handleOverride = (path: string, value: number) => {
    setOverrides((prev: any) => ({
      ...prev,
      [path]: value
    }));
  };

  const getVal = (path: string, defaultValue: number = 0) => {
    if (overrides[path] !== undefined) return overrides[path];
    
    // Resolve path in data
    try {
      const parts = path.split('.');
      let current = data;
      for (const part of parts) {
        current = current[part];
      }
      return current || defaultValue;
    } catch (e) {
      return defaultValue;
    }
  };

  // Check if business has GSTIN
  const hasGSTIN = business?.gstin && business.gstin.trim().length > 0;

  // Redirect if GSTIN is missing
  useEffect(() => {
    if (business && !hasGSTIN) {
      const confirmed = window.confirm(
        'GSTR-9 reports require a business GSTIN. Would you like to add your GSTIN in Settings?'
      );
      if (confirmed) {
        router.push('/settings?tab=tax');
      } else {
        router.push('/reports');
      }
    }
  }, [business, hasGSTIN, router]);

  const fetchReport = async () => {
    if (!business) return;
    setLoading(true);
    try {
      const query = new URLSearchParams({
        business_id: business.id,
        user_id: user?.id || '', // Required for authorization
        financial_year: financialYear.toString()
      });
      
      const res = await fetch(`/api/reports/gst/gstr9?${query}`);
      const json = await res.json();
      if (res.ok) {
        setData(json);
      } else {
        console.error(json.error);
        toast.error(json.error || 'Failed to fetch GSTR-9 data');
      }
    } catch (error) {
      console.error(error);
      toast.error('Error fetching GSTR-9 data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (business && hasGSTIN) {
      fetchReport();
    }
  }, [business, hasGSTIN, financialYear]);

  // Show message if GSTIN is missing
  if (!business) {
    return (
      
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto"></div>
            <p className="mt-4 text-text-secondary">Loading...</p>
          </div>
        </div>
      
    );
  }

  if (!hasGSTIN) {
    return (
      
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="max-w-md text-center">
            <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <AlertCircle className="w-8 h-8 text-amber-600" />
            </div>
            <h2 className="text-xl font-semibold text-text-primary mb-2">GSTIN Required</h2>
            <p className="text-text-secondary mb-6">
              GSTR-9 reports are only available for businesses with a registered GSTIN. 
              Please add your business GSTIN in Settings to access GST returns.
            </p>
            <button
              onClick={() => router.push('/settings?tab=tax')}
              className="px-6 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
            >
              Go to Settings
            </button>
          </div>
        </div>
      
    );
  }

  const handleExport = async (format: 'json' | 'csv') => {
    if (!business) return;
    const query = new URLSearchParams({
      business_id: business.id,
      financial_year: financialYear.toString(),
      format: format,
      overrides: JSON.stringify(overrides)
    });
    
    window.open(`/api/reports/gst/gstr9?${query}`, '_blank');
  };

  return (
    
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">GSTR-9 Annual Return</h1>
            <p className="text-sm text-gray-500">Annual consolidated return for the financial year (CA-Grade Rebuild)</p>
          </div>
          <div className="flex gap-3">
            <button 
              onClick={() => handleExport('json')}
              className="flex items-center gap-2 px-4 py-2 bg-slate-100 text-primary-700 rounded-lg hover:bg-primary-200"
            >
              <FileText className="w-4 h-4" />
              Export JSON
            </button>
            <button 
              onClick={() => handleExport('csv')}
              className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
            >
              <Download className="w-4 h-4" />
              Export CSV ZIP
            </button>
          </div>
        </div>

        {/* Validation Warnings */}
        {data?.validation?.warnings?.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 p-4 rounded-xl">
            <div className="flex items-center gap-2 text-amber-800 font-semibold mb-2">
              <AlertCircle className="w-5 h-5" />
              Validation Warnings ({data.validation.warnings.length})
            </div>
            <ul className="list-disc pl-5 space-y-1 text-sm text-amber-700">
              {data.validation.warnings.map((w: string, i: number) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Filters */}
        <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-200 flex flex-wrap gap-4 items-end">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Financial Year</label>
            <select 
              value={financialYear} 
              onChange={(e) => setFinancialYear(parseInt(e.target.value))}
              className="px-3 py-2 bg-white border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 outline-none min-w-[140px]"
            >
              {Array.from({ length: 10 }, (_, i) => currentYear - i).map(y => (
                <option key={y} value={y}>FY {y}-{(y + 1).toString().slice(-2)}</option>
              ))}
            </select>
          </div>

          <button 
            onClick={fetchReport}
            className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 ml-auto flex items-center gap-2"
            disabled={loading}
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        {/* Summary Cards */}
        {data?.table_4?.N && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-gradient-to-br from-red-50 to-orange-50 p-6 rounded-xl border border-red-200">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-medium text-red-700">Total Outward Supplies</p>
                <TrendingUp className="w-5 h-5 text-red-500" />
              </div>
              <p className="text-3xl font-bold text-gray-900">₹{getVal('table_4.N.taxable_value').toLocaleString('en-IN', { minimumFractionDigits: 2 })}</p>
              <p className="text-xs text-gray-600 mt-1">From Table 4N (Books)</p>
            </div>
            
            <div className="bg-gradient-to-br from-green-50 to-emerald-50 p-6 rounded-xl border border-green-200">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-medium text-green-700">Total ITC Availed</p>
                <TrendingDown className="w-5 h-5 text-green-500" />
              </div>
              <p className="text-3xl font-bold text-gray-900">₹{(getVal('table_6.O.igst') + getVal('table_6.O.cgst') + getVal('table_6.O.sgst')).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</p>
              <p className="text-xs text-gray-600 mt-1">From Table 6O (Books)</p>
            </div>
            
            <div className="bg-gradient-to-br from-slate-50 to-cyan-50 p-6 rounded-xl border border-primary-200">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-medium text-primary-700">Net ITC (Table 7J)</p>
                <MinusCircle className="w-5 h-5 text-primary-500" />
              </div>
              <p className="text-3xl font-bold text-gray-900">₹{(getVal('table_7.J.igst') + getVal('table_7.J.cgst') + getVal('table_7.J.sgst')).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</p>
              <p className="text-xs text-gray-600 mt-1">After reversals</p>
            </div>
          </div>
        )}

        {/* Tables */}
        <div className="space-y-6">
          {/* Table 4 - Outward */}
          {data?.table_4 && (
            <Section title="Table 4: Details of advances, inwards and outward supplies on which tax is payable">
              <TaxTable 
                onOverride={handleOverride}
                returnData={data.table_4_return}
                rows={[
                  { id: '4A', label: 'Supplies made to un-registered persons (B2C)', data: data.table_4.A, path: 'table_4.A' },
                  { id: '4B', label: 'Supplies made to registered persons (B2B)', data: data.table_4.B, path: 'table_4.B' },
                  { id: '4C', label: 'Zero rated supply (Export) on payment of tax', data: data.table_4.C, path: 'table_4.C' },
                  { id: '4D', label: 'Supply to SEZs on payment of tax', data: data.table_4.D, path: 'table_4.D' },
                  { id: '4E', label: 'Deemed Exports', data: data.table_4.E, path: 'table_4.E' },
                  { id: '4F', label: 'Advances on which tax has been paid', data: data.table_4.F, path: 'table_4.F' },
                  { id: '4G', label: 'Inward supplies on which tax is to be paid on RCM', data: data.table_4.G, path: 'table_4.G' },
                  { id: '4H', label: 'Sub-total (A to G above)', data: data.table_4.H, path: 'table_4.H', isBold: true },
                  { id: '4I', label: 'Credit Notes issued (-)', data: data.table_4.I, path: 'table_4.I' },
                  { id: '4J', label: 'Debit Notes issued (+)', data: data.table_4.J, path: 'table_4.J' },
                  { id: '4K', label: 'Supplies declared through Amendments (+)', data: data.table_4.K, path: 'table_4.K' },
                  { id: '4L', label: 'Supplies reduced through Amendments (-)', data: data.table_4.L, path: 'table_4.L' },
                  { id: '4M', label: 'Sub-total (I to L above)', data: data.table_4.M, path: 'table_4.M', isBold: true },
                  { id: '4N', label: 'Supplies and advances on which tax is to be paid (H + M)', data: data.table_4.N, path: 'table_4.N', isBold: true },
                ]}
              />
            </Section>
          )}

          {/* Table 5 - Outward (No Tax) */}
          {data?.table_5 && (
            <Section title="Table 5: Details of Outward supplies on which tax is not payable">
              <TaxTable 
                onOverride={handleOverride}
                returnData={data.table_5_return}
                rows={[
                  { id: '5A', label: 'Zero rated supply (Export) without payment of tax', data: data.table_5.A, path: 'table_5.A' },
                  { id: '5B', label: 'Supply to SEZs without payment of tax', data: data.table_5.B, path: 'table_5.B' },
                  { id: '5C', label: 'Supplies on which tax is to be paid by recipient (RCM)', data: data.table_5.C, path: 'table_5.C' },
                  { id: '5D', label: 'Exempted', data: data.table_5.D, path: 'table_5.D' },
                  { id: '5E', label: 'Nil Rated', data: data.table_5.E, path: 'table_5.E' },
                  { id: '5F', label: 'Non-GST supply', data: data.table_5.F, path: 'table_5.F' },
                  { id: '5G', label: 'Sub-total (A to F above)', data: data.table_5.G, path: 'table_5.G', isBold: true },
                  { id: '5H', label: 'Credit Notes issued (-)', data: data.table_5.H, path: 'table_5.H' },
                  { id: '5I', label: 'Debit Notes issued (+)', data: data.table_5.I, path: 'table_5.I' },
                  { id: '5J', label: 'Supplies declared through Amendments (+)', data: data.table_5.J, path: 'table_5.J' },
                  { id: '5K', label: 'Supplies reduced through Amendments (-)', data: data.table_5.K, path: 'table_5.K' },
                  { id: '5L', label: 'Sub-Total (H to K above)', data: data.table_5.L, path: 'table_5.L', isBold: true },
                  { id: '5M', label: 'Turnover on which tax is not to be paid (G + L)', data: data.table_5.M, path: 'table_5.M', isBold: true },
                  { id: '5N', label: 'Total Turnover (including advances) (4N + 5M - 4G)', data: data.table_5.N, path: 'table_5.N', isBold: true },
                ]}
              />
            </Section>
          )}

          {/* Table 6 - ITC */}
          {data?.table_6 && (
            <Section title="Table 6: Details of ITC availed during the financial year">
              <ITCDetailsTable itcDetails={data.table_6} onOverride={handleOverride} />
            </Section>
          )}

          {/* Table 7 - Reversals */}
          {data?.table_7 && (
            <Section title="Table 7: Details of ITC Reversed and Ineligible ITC">
              <div className="mb-4 p-3 bg-amber-50 text-amber-800 text-xs rounded border border-amber-200 font-medium uppercase tracking-wider">
                Manual declaration required as per GST law. No automatic reversal logic applied.
              </div>
              <TaxTable 
                onOverride={handleOverride}
                rows={[
                  { id: '7A', label: 'As per Rule 37', data: data.table_7.A, path: 'table_7.A' },
                  { id: '7B', label: 'As per Rule 39', data: data.table_7.B, path: 'table_7.B' },
                  { id: '7C', label: 'As per Rule 42', data: data.table_7.C, path: 'table_7.C' },
                  { id: '7D', label: 'As per Rule 43', data: data.table_7.D, path: 'table_7.D' },
                  { id: '7E', label: 'As per Section 17(5)', data: data.table_7.E, path: 'table_7.E' },
                  { id: '7I', label: 'Total ITC Reversed', data: data.table_7.I, path: 'table_7.I', isBold: true },
                  { id: '7J', label: 'Net ITC Available for Utilization (6O - 7I)', data: data.table_7.J, path: 'table_7.J', isBold: true },
                ]}
              />
            </Section>
          )}

          {/* Table 8 - Comparison */}
          {data?.table_8 && (
            <Section title="Table 8: Other ITC related information">
              <div className="mb-4 p-3 bg-slate-50 text-primary-800 text-xs rounded border border-primary-200 font-medium uppercase tracking-wider">
                GSTR-2A/2B values are read-only reference from returns. No auto-reconciliation applied.
              </div>
              <TaxTable 
                onOverride={handleOverride}
                rows={[
                  { id: '8A', label: 'ITC as per GSTR-2B', data: data.table_8.A, path: 'table_8.A' },
                  { id: '8B', label: 'ITC as per sum total of 6(B) and 6(H) above', data: data.table_8.B, path: 'table_8.B' },
                  { id: '8C', label: 'ITC on inward supplies received during FY but availed in next FY', data: data.table_8.C, path: 'table_8.C' },
                  { id: '8D', label: 'Difference [A - (B + C)]', data: data.table_8.D, path: 'table_8.D', isBold: true },
                ]}
              />
            </Section>
          )}

          {/* Table 9 - Tax Paid */}
          {data?.table_9 && (
            <Section title="Table 9: Details of tax paid as declared in returns filed during the FY">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left font-medium text-gray-700">Description</th>
                      <th className="px-4 py-3 text-right font-medium text-gray-700">Tax Payable (₹)</th>
                      <th className="px-4 py-3 text-right font-medium text-gray-700">Paid in Cash (₹)</th>
                      <th className="px-4 py-3 text-right font-medium text-gray-700">Paid through ITC (₹)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {['igst', 'cgst', 'sgst', 'cess'].map(tax => (
                      <tr key={tax} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-gray-900 uppercase font-medium">{tax}</td>
                        <td className="px-4 py-3 text-right">
                          <EditableCell value={(data.table_9 as any)[tax].payable} onChange={(v) => handleOverride(`table_9.${tax}.payable`, v)} />
                        </td>
                        <td className="px-4 py-3 text-right">
                          <EditableCell value={(data.table_9 as any)[tax].cash} onChange={(v) => handleOverride(`table_9.${tax}.cash`, v)} />
                        </td>
                        <td className="px-4 py-3 text-right">
                          <EditableCell value={(data.table_9 as any)[tax].credit} onChange={(v) => handleOverride(`table_9.${tax}.credit`, v)} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>
          )}

          {/* Table 10-14 - Next FY */}
          {data?.table_10_14 && (
            <Section title="Part V: Particulars of the transactions declared in next FY">
              <div className="mb-4 p-3 bg-amber-50 text-amber-800 text-xs rounded border border-amber-200 font-medium uppercase tracking-wider">
                Manual declaration required. Defaults to blank/zero.
              </div>
              <TaxTable 
                onOverride={handleOverride}
                rows={[
                  { id: '10', label: 'Supplies declared through Amendments/Credit Notes (+)', data: data.table_10_14[10], path: 'table_10_14.10' },
                  { id: '11', label: 'Supplies reduced through Amendments/Credit Notes (-)', data: data.table_10_14[11], path: 'table_10_14.11' },
                  { id: '12', label: 'Reversal of ITC availed during previous FY', data: data.table_10_14[12], path: 'table_10_14.12' },
                  { id: '13', label: 'ITC availed for previous FY', data: data.table_10_14[13], path: 'table_10_14.13' },
                ]}
              />
            </Section>
          )}

          {/* Table 15 & 16 */}
          {data && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Section title="Table 15: Demands and Refunds">
                <div className="mb-4 p-2 bg-amber-50 text-amber-800 text-xs rounded border border-amber-200 font-medium uppercase tracking-wider">
                  Manual declaration required as per GST law.
                </div>
                <div className="space-y-4">
                  {['A', 'B', 'C', 'D', 'E', 'F', 'G'].map(label => {
                    const desc = label === 'A' ? 'Total Refund Claimed' : label === 'B' ? 'Total Refund Sanctioned' : label === 'C' ? 'Total Refund Rejected' : label === 'D' ? 'Total Refund Pending' : label === 'E' ? 'Total Demand of Taxes' : label === 'F' ? 'Total Demand Paid' : 'Total Demand Pending';
                    return (
                      <div key={label} className="flex justify-between items-center text-sm">
                        <span className="text-gray-600">{label}. {desc}</span>
                        <EditableCell value={(data.table_15 as any)[label].taxable_value} onChange={(v) => handleOverride(`table_15.${label}.taxable_value`, v)} />
                      </div>
                    );
                  })}
                </div>
              </Section>
              <Section title="Table 16: Composition & Deemed Supplies">
                <div className="mb-4 p-2 bg-amber-50 text-amber-800 text-xs rounded border border-amber-200 font-medium uppercase tracking-wider">
                  Manual declaration required as per GST law.
                </div>
                <div className="space-y-4">
                  {['A', 'B', 'C'].map(label => {
                    const desc = label === 'A' ? 'Supplies from Composition taxpayers' : label === 'B' ? 'Deemed supply under section 143' : 'Goods sent on approval basis';
                    return (
                      <div key={label} className="flex justify-between items-center text-sm">
                        <span className="text-gray-600">{label}. {desc}</span>
                        <EditableCell value={(data.table_16 as any)[label].taxable_value} onChange={(v) => handleOverride(`table_16.${label}.taxable_value`, v)} />
                      </div>
                    );
                  })}
                </div>
              </Section>
            </div>
          )}

          {/* Table 17 - HSN Outward */}
          {data?.hsn_outward && data.hsn_outward.length > 0 && (
            <Section title="Table 17: HSN Summary of Outward Supplies">
              <HSNTable hsnData={data.hsn_outward} />
            </Section>
          )}
        </div>
      </div>
    
  );
}

function Section({ title, children }: { title: string, children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
      <div className="bg-gray-50 px-6 py-3 border-b border-gray-200">
        <h3 className="font-semibold text-gray-900">{title}</h3>
      </div>
      <div className="p-6">
        {children}
      </div>
    </div>
  );
}

function TaxTable({ rows, onOverride, returnData }: { rows: Array<{ id: string, label: string, data: any, path: string, isBold?: boolean }>, onOverride?: (path: string, val: number) => void, returnData?: any }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-4 py-3 text-left font-medium text-gray-700 w-12">ID</th>
            <th className="px-4 py-3 text-left font-medium text-gray-700">Description</th>
            <th className="px-4 py-3 text-right font-medium text-gray-700">Taxable Value</th>
            <th className="px-4 py-3 text-right font-medium text-gray-700">IGST</th>
            <th className="px-4 py-3 text-right font-medium text-gray-700">CGST</th>
            <th className="px-4 py-3 text-right font-medium text-gray-700">SGST</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((row, i) => (
            <tr key={i} className={`hover:bg-gray-50 ${row.isBold ? 'font-bold bg-gray-50' : ''}`}>
              <td className="px-4 py-3 text-gray-500 font-mono text-xs">{row.id}</td>
              <td className="px-4 py-3 text-gray-900">{row.label}</td>
              <td className="px-4 py-3 text-right">
                <EditableCell value={row.data.taxable_value} onChange={(v) => onOverride?.(`${row.path}.taxable_value`, v)} isBold={row.isBold} />
              </td>
              <td className="px-4 py-3 text-right">
                <EditableCell value={row.data.igst} onChange={(v) => onOverride?.(`${row.path}.igst`, v)} isBold={row.isBold} />
              </td>
              <td className="px-4 py-3 text-right">
                <EditableCell value={row.data.cgst} onChange={(v) => onOverride?.(`${row.path}.cgst`, v)} isBold={row.isBold} />
              </td>
              <td className="px-4 py-3 text-right">
                <EditableCell value={row.data.sgst} onChange={(v) => onOverride?.(`${row.path}.sgst`, v)} isBold={row.isBold} />
              </td>
            </tr>
          ))}
          {returnData && (
            <tr className="bg-slate-50 text-primary-800 italic">
              <td colSpan={2} className="px-4 py-2 text-xs font-semibold uppercase">Returns (Comparison - GSTR-1)</td>
              <td className="px-4 py-2 text-right">₹{returnData.taxable_value.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
              <td className="px-4 py-2 text-right">₹{(returnData.igst || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
              <td className="px-4 py-2 text-right">₹{(returnData.cgst || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
              <td className="px-4 py-2 text-right">₹{(returnData.sgst || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function EditableCell({ value, onChange, isBold }: { value: number, onChange: (v: number) => void, isBold?: boolean }) {
  const [isEditing, setIsEditing] = useState(false);
  const [val, setVal] = useState(value.toString());

  useEffect(() => {
    setVal(value.toString());
  }, [value]);

  if (isEditing) {
    return (
      <input
        autoFocus
        type="number"
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onBlur={() => {
          setIsEditing(false);
          onChange(parseFloat(val) || 0);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            setIsEditing(false);
            onChange(parseFloat(val) || 0);
          }
        }}
        className="w-24 px-1 py-0.5 border border-primary-500 rounded text-right outline-none"
      />
    );
  }

  return (
    <span 
      onClick={() => setIsEditing(true)}
      className={`cursor-pointer hover:bg-slate-50 px-1 py-0.5 rounded transition-colors ${isBold ? 'font-bold' : ''}`}
    >
      ₹{value.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
    </span>
  );
}

function HSNTable({ hsnData }: { hsnData: any[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-4 py-3 text-left font-medium text-gray-700">HSN/SAC</th>
            <th className="px-4 py-3 text-left font-medium text-gray-700">Description</th>
            <th className="px-4 py-3 text-left font-medium text-gray-700">UQC</th>
            <th className="px-4 py-3 text-right font-medium text-gray-700">Qty</th>
            <th className="px-4 py-3 text-right font-medium text-gray-700">Value</th>
            <th className="px-4 py-3 text-right font-medium text-gray-700">Taxable</th>
            <th className="px-4 py-3 text-right font-medium text-gray-700">IGST</th>
            <th className="px-4 py-3 text-right font-medium text-gray-700">CGST</th>
            <th className="px-4 py-3 text-right font-medium text-gray-700">SGST</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {hsnData.map((hsn: any, i: number) => (
            <tr key={i} className="hover:bg-gray-50">
              <td className="px-4 py-3 text-gray-900">{hsn.hsn_sac}</td>
              <td className="px-4 py-3 text-gray-900">{hsn.description}</td>
              <td className="px-4 py-3 text-gray-700">{hsn.uqc}</td>
              <td className="px-4 py-3 text-right text-gray-700">{hsn.total_quantity.toLocaleString('en-IN')}</td>
              <td className="px-4 py-3 text-right text-gray-700">₹{hsn.total_value.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
              <td className="px-4 py-3 text-right text-gray-700">₹{hsn.taxable_value.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
              <td className="px-4 py-3 text-right text-gray-700">₹{hsn.igst.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
              <td className="px-4 py-3 text-right text-gray-700">₹{hsn.cgst.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
              <td className="px-4 py-3 text-right text-gray-700">₹{hsn.sgst.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ITCDetailsTable({ itcDetails, onOverride }: { itcDetails: any, onOverride?: (path: string, val: number) => void }) {
  const rows = [
    // Row A
    {
      description: 'Total amount of input tax credit availed through FORM GSTR-3B (Sum total of table 4A of FORM GSTR-3B)',
      type: '',
      data: itcDetails.A,
      path: 'table_6.A',
      indent: 0
    },
    // Row B
    {
      description: 'Inward supplies (other than imports and inward supplies liable to reverse charge but includes services received from SEZs)',
      type: '',
      data: null,
      indent: 0
    },
    {
      description: '',
      type: 'Inputs',
      data: itcDetails.B.inputs,
      path: 'table_6.B.inputs',
      indent: 1
    },
    {
      description: '',
      type: 'Capital Goods',
      data: itcDetails.B.capital_goods,
      path: 'table_6.B.capital_goods',
      indent: 1
    },
    {
      description: '',
      type: 'Input Services',
      data: itcDetails.B.input_services,
      path: 'table_6.B.input_services',
      indent: 1
    },
    // Row C
    {
      description: 'Inward supplies received from unregistered persons liable to reverse charge',
      type: '',
      data: null,
      indent: 0
    },
    {
      description: '',
      type: 'Inputs',
      data: itcDetails.C.inputs,
      path: 'table_6.C.inputs',
      indent: 1
    },
    {
      description: '',
      type: 'Capital Goods',
      data: itcDetails.C.capital_goods,
      path: 'table_6.C.capital_goods',
      indent: 1
    },
    {
      description: '',
      type: 'Input Services',
      data: itcDetails.C.input_services,
      path: 'table_6.C.input_services',
      indent: 1
    },
    // Row D
    {
      description: 'Inward supplies received from registered persons liable to reverse charge',
      type: '',
      data: null,
      indent: 0
    },
    {
      description: '',
      type: 'Inputs',
      data: itcDetails.D.inputs,
      path: 'table_6.D.inputs',
      indent: 1
    },
    {
      description: '',
      type: 'Capital Goods',
      data: itcDetails.D.capital_goods,
      path: 'table_6.D.capital_goods',
      indent: 1
    },
    {
      description: '',
      type: 'Input Services',
      data: itcDetails.D.input_services,
      path: 'table_6.D.input_services',
      indent: 1
    },
    // Row E
    {
      description: 'Import of goods (including supplies from SEZs)',
      type: '',
      data: null,
      indent: 0
    },
    {
      description: '',
      type: 'Inputs',
      data: itcDetails.E.inputs,
      path: 'table_6.E.inputs',
      indent: 1
    },
    {
      description: '',
      type: 'Capital Goods',
      data: itcDetails.E.capital_goods,
      path: 'table_6.E.capital_goods',
      indent: 1
    },
    // Row F
    {
      description: 'Import of services (excluding inward supplies from SEZs)',
      type: '',
      data: itcDetails.F,
      path: 'table_6.F',
      indent: 0
    },
    // Row G
    {
      description: 'Input Tax Credit received from ISD',
      type: '',
      data: itcDetails.G,
      path: 'table_6.G',
      indent: 0
    },
    // Row H
    {
      description: 'Amount of ITC reclaimed (other than B above) under the provisions of the Act',
      type: '',
      data: itcDetails.H,
      path: 'table_6.H',
      indent: 0
    },
    // Row I
    {
      description: 'Sub-total (B to H above)',
      type: '',
      data: itcDetails.I,
      path: 'table_6.I',
      indent: 0,
      isBold: true
    },
    // Row J
    {
      description: 'Difference (I - A above)',
      type: '',
      data: itcDetails.J,
      path: 'table_6.J',
      indent: 0,
      isBold: true
    },
    // Row N
    {
      description: 'Sub-total (K to M above)',
      type: '',
      data: itcDetails.N,
      path: 'table_6.N',
      indent: 0,
      isBold: true
    },
    // Row O
    {
      description: 'Total ITC availed (I + N) above',
      type: '',
      data: itcDetails.O,
      path: 'table_6.O',
      indent: 0,
      isBold: true
    },
  ];
  
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-4 py-3 text-left font-medium text-gray-700">Description</th>
            <th className="px-4 py-3 text-left font-medium text-gray-700">Type</th>
            <th className="px-4 py-3 text-right font-medium text-gray-700">Integrated Tax</th>
            <th className="px-4 py-3 text-right font-medium text-gray-700">Central Tax</th>
            <th className="px-4 py-3 text-right font-medium text-gray-700">State Tax / UT Tax</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((row, i) => {
            if (row.data === null) {
              return (
                <tr key={i} className="bg-gray-50/50">
                  <td className={`px-4 py-3 text-gray-900 ${row.indent > 0 ? 'pl-8' : ''}`}>
                    {row.description}
                  </td>
                  <td colSpan={4}></td>
                </tr>
              );
            }
            
            return (
              <tr key={i} className={`hover:bg-gray-50 ${row.isBold ? 'font-semibold bg-gray-50' : ''}`}>
                <td className={`px-4 py-3 text-gray-900 ${row.indent > 0 ? 'pl-8' : ''}`}>
                  {row.description}
                </td>
                <td className="px-4 py-3 text-gray-700">{row.type}</td>
                <td className="px-4 py-3 text-right">
                  <EditableCell value={row.data.igst} onChange={(v) => onOverride?.(`${row.path}.igst`, v)} isBold={row.isBold} />
                </td>
                <td className="px-4 py-3 text-right">
                  <EditableCell value={row.data.cgst} onChange={(v) => onOverride?.(`${row.path}.cgst`, v)} isBold={row.isBold} />
                </td>
                <td className="px-4 py-3 text-right">
                  <EditableCell value={row.data.sgst} onChange={(v) => onOverride?.(`${row.path}.sgst`, v)} isBold={row.isBold} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

