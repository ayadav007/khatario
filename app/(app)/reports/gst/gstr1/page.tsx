'use client';

export const dynamic = 'force-dynamic';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { Download, FileText, Filter, RefreshCw, ChevronDown, AlertCircle, FileCheck } from 'lucide-react';
import * as Tabs from '@radix-ui/react-tabs';
import { format } from 'date-fns';
import { FeatureRouteGuard } from '@/components/guards/FeatureRouteGuard';
import { FeatureKeys } from '@/lib/featureKeys';
import { useToastContext } from '@/contexts/ToastContext';

interface GSTR1Data {
  summary: {
    total_outward_taxable_supplies: number;
    total_tax_amount: number;
    invoice_count: number;
    b2b_count: number;
    b2cl_count: number;
    b2cs_count: number;
  };
  b2b: any[];
  b2cl: any[];
  b2cs: any[];
  hsn: any[];
  nil: any[];
  exports: any[];
  sez?: any[];
  cdn: any[];
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

function GSTR1PageContent() {
  const { business, user } = useAuth();
  const router = useRouter();
  const toast = useToastContext();
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<GSTR1Data | null>(null);
  const [filingInfo, setFilingInfo] = useState<any>(null);
  const [markingAsFiled, setMarkingAsFiled] = useState(false);
  
  // Filters
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [year, setYear] = useState(new Date().getFullYear());
  const [customerType, setCustomerType] = useState('all'); // all, b2b, b2c

  // Check if business has GSTIN
  const hasGSTIN = business?.gstin && business.gstin.trim().length > 0;

  // Redirect if GSTIN is missing
  useEffect(() => {
    if (business && !hasGSTIN) {
      const confirmed = window.confirm(
        'GSTR-1 reports require a business GSTIN. Would you like to add your GSTIN in Settings?'
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
        month: month.toString(),
        year: year.toString(),
        customer_type: customerType
      });
      
      const res = await fetch(`/api/reports/gst/gstr1?${query}`);
      const json = await res.json();
      if (res.ok) {
        setData(json);
        // Fetch filing info if filing_id is present
        if (json.filing_id) {
          fetchFilingInfo(json.filing_id);
        } else {
          // Try to find filing for this period
          const filingPeriod = `${year}-${month.toString().padStart(2, '0')}`;
          fetchFilingByPeriod(filingPeriod);
        }
      } else {
        console.error(json.error);
        if (json.code === 'GSTIN_MISSING') {
          toast.error(`${json.error} — ${json.message}`);
          window.location.href = '/settings?tab=tax';
        } else {
          toast.error(json.error || 'Failed to fetch GSTR-1 data');
        }
      }
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (business) {
      fetchReport();
    }
  }, [business, month, year, customerType]);

  const fetchFilingInfo = async (filingId: string) => {
    if (!business) return;
    try {
      const res = await fetch(`/api/reports/gst/gstr1/filings?business_id=${business.id}&user_id=${user?.id}`);
      if (res.ok) {
        const json = await res.json();
        const filing = json.filings.find((f: any) => f.id === filingId);
        if (filing) {
          setFilingInfo(filing);
        }
      }
    } catch (error) {
      console.error('Error fetching filing info:', error);
    }
  };

  const fetchFilingByPeriod = async (period: string) => {
    if (!business) return;
    try {
      const res = await fetch(`/api/reports/gst/gstr1/filings?business_id=${business.id}&user_id=${user?.id}`);
      if (res.ok) {
        const json = await res.json();
        const filing = json.filings.find((f: any) => f.filing_period === period);
        if (filing) {
          setFilingInfo(filing);
        }
      }
    } catch (error) {
      console.error('Error fetching filing by period:', error);
    }
  };

  const handleMarkAsFiled = async () => {
    if (!filingInfo || !business) return;
    
    const confirmed = window.confirm(
      `Are you sure you want to mark GSTR-1 for ${filingInfo.filing_period} as filed?\n\n` +
      `This will lock all ${filingInfo.invoice_count || 0} invoices included in this filing and prevent them from being edited.\n\n` +
      `This action cannot be undone.`
    );
    
    if (!confirmed) return;
    
    setMarkingAsFiled(true);
    try {
      const res = await fetch(`/api/reports/gst/gstr1/${filingInfo.id}/mark-filed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filed_by: user?.id || null })
      });
      
      if (res.ok) {
        toast.success('GSTR-1 marked as filed successfully. All invoices have been locked.');
        await fetchFilingInfo(filingInfo.id);
        // Refresh the report to update status indicators
        await fetchReport();
      } else {
        const error = await res.json();
        toast.error(error.error || 'Failed to mark filing as filed');
      }
    } catch (error) {
      console.error('Error marking as filed:', error);
      toast.error('Failed to mark filing as filed');
    } finally {
      setMarkingAsFiled(false);
    }
  };

  const handleExport = async (format: 'xlsx' | 'xlsx_offline_v22' | 'json') => {
    if (!business) return;
    
    try {
      let url: string;
      let filename: string;
      
      if (format === 'xlsx') {
        url = `/api/reports/gst/gstr1/export/excel?business_id=${business.id}&month=${month}&year=${year}`;
        filename = `GSTR1_${month.toString().padStart(2, '0')}_${year}.xlsx`;
      } else if (format === 'xlsx_offline_v22') {
        url = `/api/reports/gst/gstr1/export/excel?business_id=${business.id}&month=${month}&year=${year}&format=offline_v22`;
        filename = `GSTR1_offline_v22_${month.toString().padStart(2, '0')}_${year}.xlsx`;
      } else {
        // Use JSON export
        const query = new URLSearchParams({
          business_id: business.id,
          user_id: user?.id || '',
          month: month.toString(),
          year: year.toString(),
          customer_type: customerType,
          export: 'json'
        });
        url = `/api/reports/gst/gstr1?${query}`;
        filename = `GSTR1_${month.toString().padStart(2, '0')}_${year}.json`;
      }
      
      const res = await fetch(url);
      if (!res.ok) {
        const error = await res.json();
        if (error.code === 'GSTIN_MISSING') {
          const confirm = window.confirm(
            `${error.error}\n\n${error.message}\n\nWould you like to open Settings to add your GSTIN?`
          );
          if (confirm) {
            window.location.href = '/settings?tab=tax';
          }
          return;
        }
        toast.error(error.error || 'Export failed');
        return;
      }
      
      // Handle file download
      const blob = await res.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      
      // Get filename from Content-Disposition header if available
      const contentDisposition = res.headers.get('Content-Disposition');
      if (contentDisposition) {
        const filenameMatch = contentDisposition.match(/filename="?(.+?)"?$/);
        if (filenameMatch) {
          filename = filenameMatch[1];
        }
      }
      
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(blobUrl);
    } catch (error) {
      console.error('Export error:', error);
      toast.error('Failed to export report');
    }
  };

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
              GSTR-1 reports are only available for businesses with a registered GSTIN. 
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

  return (
    
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">GSTR-1 Report</h1>
            <p className="text-sm text-gray-500">Details of outward supplies of goods or services</p>
            {filingInfo && (
              <div className="mt-2 flex items-center gap-2">
                <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${
                  filingInfo.status === 'filed' 
                    ? 'bg-green-100 text-green-700 border border-green-200' 
                    : 'bg-amber-100 text-amber-700 border border-amber-200'
                }`}>
                  {filingInfo.status === 'filed' ? '✓ Filed' : 'Draft'}
                </span>
                {filingInfo.filing_period && (
                  <span className="text-xs text-gray-500">Period: {filingInfo.filing_period}</span>
                )}
                {filingInfo.invoice_count !== undefined && (
                  <span className="text-xs text-gray-500">• {filingInfo.invoice_count} invoices</span>
                )}
              </div>
            )}
          </div>
          <div className="flex gap-3">
            {filingInfo && filingInfo.status === 'draft' && (
              <button 
                onClick={handleMarkAsFiled}
                disabled={markingAsFiled}
                className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {markingAsFiled ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Marking...
                  </>
                ) : (
                  <>
                    <FileCheck className="w-4 h-4" />
                    Mark as Filed
                  </>
                )}
              </button>
            )}
            <button 
              onClick={() => handleExport('xlsx')}
              className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
            >
              <Download className="w-4 h-4" />
              Export Excel
            </button>
            <button
              type="button"
              onClick={() => handleExport('xlsx_offline_v22')}
              className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
              title="Uses GST portal GSTR1_Excel_Workbook_Template_V2.2 layout for the Java offline tool"
            >
              <Download className="w-4 h-4" />
              Offline tool Excel
            </button>
            <button 
              onClick={() => handleExport('json')}
              className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
            >
              <FileText className="w-4 h-4" />
              Export JSON
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-200 flex flex-wrap gap-4 items-end">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Month</label>
            <select 
              value={month} 
              onChange={(e) => setMonth(parseInt(e.target.value))}
              className="px-3 py-2 bg-white border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 outline-none min-w-[140px]"
            >
              {MONTHS.map((m, i) => (
                <option key={i} value={i + 1}>{m}</option>
              ))}
            </select>
          </div>
          
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Year</label>
            <select 
              value={year} 
              onChange={(e) => setYear(parseInt(e.target.value))}
              className="px-3 py-2 bg-white border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 outline-none min-w-[100px]"
            >
              {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i).map(y => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Customer Type</label>
            <select 
              value={customerType} 
              onChange={(e) => setCustomerType(e.target.value)}
              className="px-3 py-2 bg-white border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 outline-none min-w-[140px]"
            >
              <option value="all">All Types</option>
              <option value="b2b">B2B Only</option>
              <option value="b2c">B2C Only</option>
            </select>
          </div>

          <button 
            onClick={fetchReport}
            className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 ml-auto flex items-center gap-2"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        {/* Summary Boxes */}
        {data?.summary && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <SummaryCard 
              label="Total Taxable Value" 
              value={`₹${data.summary.total_outward_taxable_supplies.toLocaleString('en-IN')}`} 
              subtext="Total Outward Supplies"
              color="blue"
            />
            <SummaryCard 
              label="Total Tax Amount" 
              value={`₹${data.summary.total_tax_amount.toLocaleString('en-IN')}`} 
              subtext="IGST + CGST + SGST"
              color="purple"
            />
            <SummaryCard 
              label="Total Invoices" 
              value={data.summary.invoice_count} 
              subtext="Generated in period"
              color="green"
            />
            <SummaryCard 
              label="B2B Count" 
              value={data.summary.b2b_count} 
              subtext="Business to Business"
              color="orange"
            />
          </div>
        )}

        {/* Tabs */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <Tabs.Root defaultValue="b2b">
            <div className="border-b border-gray-200 overflow-x-auto">
              <Tabs.List className="flex min-w-max">
                <TabTrigger value="b2b" label="B2B Invoices" count={data?.b2b.length} />
                <TabTrigger value="b2cl" label="B2C Large" count={data?.b2cl.length} />
                <TabTrigger value="b2cs" label="B2C Small" count={data?.b2cs.length} />
                <TabTrigger value="exports" label="Exports" count={data?.exports.length} />
                {data?.sez && data.sez.length > 0 && (
                  <TabTrigger value="sez" label="SEZ" count={data.sez.length} />
                )}
                <TabTrigger value="cdn" label="CDNR" count={data?.cdn.length} />
                <TabTrigger value="nil" label="Nil Rated" count={data?.nil.length} />
                <TabTrigger value="hsn" label="HSN Summary" count={data?.hsn.length} />
              </Tabs.List>
            </div>

            <div className="p-0">
              <Tabs.Content value="b2b">
                <B2BTable rows={data?.b2b || []} />
              </Tabs.Content>
              
              <Tabs.Content value="b2cl">
                <B2CLTable rows={data?.b2cl || []} />
              </Tabs.Content>

              <Tabs.Content value="b2cs">
                <B2CSTable rows={data?.b2cs || []} />
              </Tabs.Content>

              <Tabs.Content value="hsn">
                <DataTable 
                   headers={['HSN/SAC', 'Description', 'UQC', 'Total Qty', 'Total Value', 'Taxable', 'IGST', 'CGST', 'SGST']}
                   rows={data?.hsn.map(i => [
                     i.hsn_sac,
                     i.description,
                     i.uqc,
                     i.total_quantity,
                     `₹${i.total_value.toFixed(2)}`,
                     `₹${i.taxable_value.toFixed(2)}`,
                     `₹${i.integrated_tax.toFixed(2)}`,
                     `₹${i.central_tax.toFixed(2)}`,
                     `₹${i.state_ut_tax.toFixed(2)}`
                   ]) || []}
                   emptyMessage="No HSN summary data"
                />
              </Tabs.Content>

              <Tabs.Content value="nil">
                <DataTable 
                   headers={['Description', 'Nil Rated', 'Exempted', 'Non-GST']}
                   rows={data?.nil.map(i => [
                     i.description,
                     `₹${i.nil_supply}`,
                     `₹${i.exempt_supply}`,
                     `₹${i.non_gst_supply}`
                   ]) || []}
                   emptyMessage="No Nil rated supplies"
                />
              </Tabs.Content>
              
              <Tabs.Content value="exports">
                <DataTable 
                   headers={['Type', 'Invoice No', 'Date', 'Value', 'Port Code', 'Shipping Bill', 'Date']}
                   rows={data?.exports.map(i => [
                     i.export_type,
                     i.invoice_number,
                     i.invoice_date,
                     `₹${i.invoice_value}`,
                     i.port_code || '-',
                     i.shipping_bill_number || '-',
                     i.shipping_bill_date || '-'
                   ]) || []}
                   emptyMessage="No Export invoices found"
                />
              </Tabs.Content>

              {data?.sez && data.sez.length > 0 && (
                <Tabs.Content value="sez">
                  <DataTable 
                     headers={['SEZ Unit GSTIN', 'Invoice No', 'Date', 'Value', 'Place of Supply', 'Type', 'Rate', 'Taxable Value', 'IGST']}
                     rows={data.sez.map(i => [
                       i.sez_unit_gstin || '-',
                       i.invoice_number,
                       i.invoice_date,
                       `₹${i.invoice_value}`,
                       i.place_of_supply || '-',
                       i.sez_type === 'WPAY' ? 'With Payment' : 'Without Payment',
                       `${i.rate}%`,
                       `₹${i.taxable_value}`,
                       `₹${i.igst_amount || 0}`
                     ])}
                     emptyMessage="No SEZ invoices found"
                  />
                </Tabs.Content>
              )}

              <Tabs.Content value="cdn">
                <CDNTable rows={data?.cdn || []} />
              </Tabs.Content>
            </div>
          </Tabs.Root>
        </div>
      </div>
    
  );
}

/** GSTN GSTIN format: 2-digit state + 10-char PAN + entity number + Z + checksum */
const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
function isValidGSTIN(g: string | null | undefined): boolean {
  if (!g) return false;
  return GSTIN_REGEX.test(g.trim().toUpperCase());
}

// ─── B2B Table ────────────────────────────────────────────────────────────────
// Groups multi-rate rows visually: invoice-level fields shown only on the first rate row.
function B2BTable({ rows }: { rows: any[] }) {
  if (rows.length === 0) {
    return <div className="p-12 text-center text-gray-500">No B2B invoices found</div>;
  }

  const fmt = (v: number) => `₹${Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  // Identify unique invalid GSTINs for validation banner
  const invalidGSTINs = [...new Set(rows.map(r => r.gstin).filter(g => !isValidGSTIN(g)))];

  // Mark each row as first-of-invoice or continuation
  const seenInvoices = new Set<string>();
  const annotated = rows.map(r => {
    const key = `${r.gstin}::${r.invoice_number}`;
    const isFirst = !seenInvoices.has(key);
    if (isFirst) seenInvoices.add(key);
    return { ...r, isFirst };
  });

  return (
    <div>
      {invalidGSTINs.length > 0 && (
        <div className="mx-4 mt-4 mb-2 flex items-start gap-2 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          <span className="font-bold mt-0.5">⚠</span>
          <div>
            <span className="font-semibold">{invalidGSTINs.length} invalid GSTIN{invalidGSTINs.length > 1 ? 's' : ''} detected.</span>
            {' '}These invoices may be rejected by the GST portal. Please correct them before filing.
            <div className="mt-1 font-mono text-xs text-red-600">{invalidGSTINs.join(', ')}</div>
          </div>
        </div>
      )}
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="bg-gray-50 border-b border-gray-200">
          <tr>
            <th className="px-4 py-3 font-medium text-gray-700 whitespace-nowrap">GSTIN</th>
            <th className="px-4 py-3 font-medium text-gray-700 whitespace-nowrap">Invoice No</th>
            <th className="px-4 py-3 font-medium text-gray-700 whitespace-nowrap">Date</th>
            <th className="px-4 py-3 font-medium text-gray-700 whitespace-nowrap text-right">Invoice Value</th>
            <th className="px-4 py-3 font-medium text-gray-700 whitespace-nowrap">Rate</th>
            <th className="px-4 py-3 font-medium text-gray-700 whitespace-nowrap text-right">Taxable</th>
            <th className="px-4 py-3 font-medium text-gray-700 whitespace-nowrap text-right">IGST</th>
            <th className="px-4 py-3 font-medium text-gray-700 whitespace-nowrap text-right">CGST</th>
            <th className="px-4 py-3 font-medium text-gray-700 whitespace-nowrap text-right">SGST</th>
            <th className="px-4 py-3 font-medium text-gray-700 whitespace-nowrap">Place of Supply</th>
            <th className="px-4 py-3 font-medium text-gray-700 whitespace-nowrap">Rev.Chg</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {annotated.map((r, i) => (
            <tr key={i} className={`transition-colors ${r.isFirst ? 'hover:bg-gray-50' : 'bg-gray-50/40 hover:bg-gray-50'}`}>
              <td className="px-4 py-2.5 whitespace-nowrap font-mono text-xs">
                {r.isFirst && (
                  <span className={`flex items-center gap-1 ${isValidGSTIN(r.gstin) ? 'text-gray-600' : 'text-red-600'}`}>
                    {!isValidGSTIN(r.gstin) && (
                      <span title={`Invalid GSTIN format: "${r.gstin}"`} className="text-red-500 font-bold">⚠</span>
                    )}
                    {r.gstin}
                  </span>
                )}
              </td>
              <td className="px-4 py-2.5 whitespace-nowrap">
                {r.isFirst
                  ? <span className="font-medium text-gray-800">{r.invoice_number}</span>
                  : <span className="text-gray-400 pl-3 text-xs">↳ {r.invoice_number}</span>
                }
              </td>
              <td className="px-4 py-2.5 text-gray-600 whitespace-nowrap">{r.isFirst ? r.invoice_date : ''}</td>
              <td className="px-4 py-2.5 text-gray-600 whitespace-nowrap text-right">{r.isFirst ? fmt(r.invoice_value) : ''}</td>
              <td className="px-4 py-2.5 whitespace-nowrap">
                <span className="px-2 py-0.5 bg-slate-50 text-primary-700 rounded-full text-xs font-medium">{r.rate}%</span>
              </td>
              <td className="px-4 py-2.5 text-gray-700 whitespace-nowrap text-right font-medium">{fmt(r.taxable_value)}</td>
              <td className="px-4 py-2.5 text-gray-600 whitespace-nowrap text-right">{fmt(r.igst_amount || 0)}</td>
              <td className="px-4 py-2.5 text-gray-600 whitespace-nowrap text-right">{fmt(r.cgst_amount || 0)}</td>
              <td className="px-4 py-2.5 text-gray-600 whitespace-nowrap text-right">{fmt(r.sgst_amount || 0)}</td>
              <td className="px-4 py-2.5 text-gray-500 whitespace-nowrap text-xs">{r.isFirst ? r.place_of_supply : ''}</td>
              <td className="px-4 py-2.5 text-gray-500 whitespace-nowrap">{r.isFirst ? (r.reverse_charge === 'Y' ? '✓' : '-') : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    </div>
  );
}

// ─── B2CL Table ───────────────────────────────────────────────────────────────
function B2CLTable({ rows }: { rows: any[] }) {
  if (rows.length === 0) {
    return <div className="p-12 text-center text-gray-500">No B2C Large invoices found</div>;
  }

  const fmt = (v: number) => `₹${Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const seenInvoices = new Set<string>();
  const annotated = rows.map(r => {
    const isFirst = !seenInvoices.has(r.invoice_number);
    if (isFirst) seenInvoices.add(r.invoice_number);
    // Determine which threshold rule qualified this invoice
    const threshold = r.invoice_value > 250000 ? '> ₹2.5L (pre-Aug 2024 rule)' : '> ₹1L (Aug 2024+ rule)';
    return { ...r, isFirst, threshold };
  });

  return (
    <div>
      <div className="mx-4 mt-4 mb-2 flex items-center gap-2 px-3 py-2 bg-slate-50 border border-primary-200 rounded-lg text-xs text-primary-700">
        <span className="font-semibold">ℹ B2CL threshold:</span>
        <span>Inter-state B2C invoices &gt; ₹1 lakh (Aug 2024+) or &gt; ₹2.5 lakh (before Aug 2024)</span>
      </div>
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="bg-gray-50 border-b border-gray-200">
          <tr>
            <th className="px-4 py-3 font-medium text-gray-700 whitespace-nowrap">Invoice No</th>
            <th className="px-4 py-3 font-medium text-gray-700 whitespace-nowrap">Date</th>
            <th className="px-4 py-3 font-medium text-gray-700 whitespace-nowrap text-right">Invoice Value</th>
            <th className="px-4 py-3 font-medium text-gray-700 whitespace-nowrap">Rate</th>
            <th className="px-4 py-3 font-medium text-gray-700 whitespace-nowrap text-right">Taxable</th>
            <th className="px-4 py-3 font-medium text-gray-700 whitespace-nowrap text-right">IGST</th>
            <th className="px-4 py-3 font-medium text-gray-700 whitespace-nowrap">Place of Supply</th>
            <th className="px-4 py-3 font-medium text-gray-700 whitespace-nowrap">Threshold</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {annotated.map((r, i) => (
            <tr key={i} className={`transition-colors ${r.isFirst ? 'hover:bg-gray-50' : 'bg-gray-50/40 hover:bg-gray-50'}`}>
              <td className="px-4 py-2.5 whitespace-nowrap">
                {r.isFirst
                  ? <span className="font-medium text-gray-800">{r.invoice_number}</span>
                  : <span className="text-gray-400 pl-3 text-xs">↳ {r.invoice_number}</span>
                }
              </td>
              <td className="px-4 py-2.5 text-gray-600 whitespace-nowrap">{r.isFirst ? r.invoice_date : ''}</td>
              <td className="px-4 py-2.5 text-gray-600 whitespace-nowrap text-right">{r.isFirst ? fmt(r.invoice_value) : ''}</td>
              <td className="px-4 py-2.5 whitespace-nowrap">
                <span className="px-2 py-0.5 bg-slate-50 text-primary-700 rounded-full text-xs font-medium">{r.rate}%</span>
              </td>
              <td className="px-4 py-2.5 text-gray-700 whitespace-nowrap text-right font-medium">{fmt(r.taxable_value)}</td>
              <td className="px-4 py-2.5 text-gray-600 whitespace-nowrap text-right">{fmt(r.igst_amount || 0)}</td>
              <td className="px-4 py-2.5 text-gray-500 whitespace-nowrap text-xs">{r.isFirst ? r.place_of_supply : ''}</td>
              <td className="px-4 py-2.5 whitespace-nowrap">
                {r.isFirst && (
                  <span className="px-2 py-0.5 bg-amber-50 text-amber-700 border border-amber-200 rounded text-xs">{r.threshold}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    </div>
  );
}

// ─── B2CS Table ───────────────────────────────────────────────────────────────
function B2CSTable({ rows }: { rows: any[] }) {
  if (rows.length === 0) {
    return <div className="p-12 text-center text-gray-500">No B2C Small invoices found</div>;
  }

  const fmt = (v: number) => `₹${Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="bg-gray-50 border-b border-gray-200">
          <tr>
            <th className="px-4 py-3 font-medium text-gray-700 whitespace-nowrap">Type</th>
            <th className="px-4 py-3 font-medium text-gray-700 whitespace-nowrap">Place of Supply</th>
            <th className="px-4 py-3 font-medium text-gray-700 whitespace-nowrap">Rate</th>
            <th className="px-4 py-3 font-medium text-gray-700 whitespace-nowrap text-right">Taxable Value</th>
            <th className="px-4 py-3 font-medium text-gray-700 whitespace-nowrap text-right">IGST</th>
            <th className="px-4 py-3 font-medium text-gray-700 whitespace-nowrap text-right">CGST</th>
            <th className="px-4 py-3 font-medium text-gray-700 whitespace-nowrap text-right">SGST</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((r, i) => (
            <tr key={i} className="hover:bg-gray-50 transition-colors">
              <td className="px-4 py-2.5 text-gray-600 whitespace-nowrap">
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${r.type === 'E-Commerce' ? 'bg-purple-50 text-purple-700' : 'bg-gray-100 text-gray-600'}`}>
                  {r.type}
                </span>
              </td>
              <td className="px-4 py-2.5 text-gray-600 whitespace-nowrap text-xs">{r.place_of_supply}</td>
              <td className="px-4 py-2.5 whitespace-nowrap">
                <span className="px-2 py-0.5 bg-slate-50 text-primary-700 rounded-full text-xs font-medium">{r.rate}%</span>
              </td>
              <td className="px-4 py-2.5 text-gray-700 whitespace-nowrap text-right font-medium">{fmt(r.taxable_value)}</td>
              <td className="px-4 py-2.5 text-gray-600 whitespace-nowrap text-right">{fmt(r.igst_amount || 0)}</td>
              <td className="px-4 py-2.5 text-gray-600 whitespace-nowrap text-right">{fmt(r.cgst_amount || 0)}</td>
              <td className="px-4 py-2.5 text-gray-600 whitespace-nowrap text-right">{fmt(r.sgst_amount || 0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── CDN Table ────────────────────────────────────────────────────────────────
function CDNTable({ rows }: { rows: any[] }) {
  if (rows.length === 0) {
    return <div className="p-12 text-center text-gray-500">No Credit/Debit Notes found for this period</div>;
  }

  const fmt = (v: number) => `₹${Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="bg-gray-50 border-b border-gray-200">
          <tr>
            <th className="px-4 py-3 font-medium text-gray-700 whitespace-nowrap">Type</th>
            <th className="px-4 py-3 font-medium text-gray-700 whitespace-nowrap">Note No</th>
            <th className="px-4 py-3 font-medium text-gray-700 whitespace-nowrap">Date</th>
            <th className="px-4 py-3 font-medium text-gray-700 whitespace-nowrap">Recipient GSTIN</th>
            <th className="px-4 py-3 font-medium text-gray-700 whitespace-nowrap text-right">Note Value</th>
            <th className="px-4 py-3 font-medium text-gray-700 whitespace-nowrap text-right">Taxable</th>
            <th className="px-4 py-3 font-medium text-gray-700 whitespace-nowrap text-right">IGST</th>
            <th className="px-4 py-3 font-medium text-gray-700 whitespace-nowrap text-right">CGST</th>
            <th className="px-4 py-3 font-medium text-gray-700 whitespace-nowrap text-right">SGST</th>
            <th className="px-4 py-3 font-medium text-gray-700 whitespace-nowrap">Orig. Invoice</th>
            <th className="px-4 py-3 font-medium text-gray-700 whitespace-nowrap">Place of Supply</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((r, i) => (
            <tr key={i} className="hover:bg-gray-50 transition-colors">
              <td className="px-4 py-2.5 whitespace-nowrap">
                <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${r.note_type === 'C' ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
                  {r.note_type === 'C' ? 'Credit' : 'Debit'}
                </span>
              </td>
              <td className="px-4 py-2.5 font-medium text-gray-800 whitespace-nowrap">{r.note_number}</td>
              <td className="px-4 py-2.5 text-gray-600 whitespace-nowrap">{r.note_date}</td>
              <td className="px-4 py-2.5 whitespace-nowrap font-mono text-xs">
                {r.gstin_uin_recipient
                  ? <span className={isValidGSTIN(r.gstin_uin_recipient) ? 'text-gray-600' : 'text-red-600'}>
                      {!isValidGSTIN(r.gstin_uin_recipient) && <span title="Invalid GSTIN" className="mr-1">⚠</span>}
                      {r.gstin_uin_recipient}
                    </span>
                  : <span className="text-gray-400 text-xs">Unregistered</span>
                }
              </td>
              <td className="px-4 py-2.5 text-gray-700 whitespace-nowrap text-right font-medium">{fmt(r.invoice_value)}</td>
              <td className="px-4 py-2.5 text-gray-700 whitespace-nowrap text-right">{fmt(r.taxable_value)}</td>
              <td className="px-4 py-2.5 text-gray-600 whitespace-nowrap text-right">{fmt(r.igst_amount || 0)}</td>
              <td className="px-4 py-2.5 text-gray-600 whitespace-nowrap text-right">{fmt(r.cgst_amount || 0)}</td>
              <td className="px-4 py-2.5 text-gray-600 whitespace-nowrap text-right">{fmt(r.sgst_amount || 0)}</td>
              <td className="px-4 py-2.5 text-gray-500 whitespace-nowrap text-xs">{r.original_invoice_number || '-'}</td>
              <td className="px-4 py-2.5 text-gray-500 whitespace-nowrap text-xs">{r.place_of_supply || '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SummaryCard({ label, value, subtext, color }: { label: string, value: string | number, subtext: string, color: 'blue' | 'purple' | 'green' | 'orange' }) {
  const colorClasses = {
    blue: 'bg-slate-50 text-primary-700 border-primary-100',
    purple: 'bg-purple-50 text-purple-700 border-purple-100',
    green: 'bg-green-50 text-green-700 border-green-100',
    orange: 'bg-orange-50 text-orange-700 border-orange-100',
  };

  return (
    <div className={`p-4 rounded-xl border ${colorClasses[color]}`}>
      <p className="text-sm font-medium opacity-80 mb-1">{label}</p>
      <p className="text-2xl font-bold mb-1">{value}</p>
      <p className="text-xs opacity-70">{subtext}</p>
    </div>
  );
}

function TabTrigger({ value, label, count }: { value: string, label: string, count?: number }) {
  return (
    <Tabs.Trigger 
      value={value}
      className="px-6 py-3 text-sm font-medium text-gray-600 border-b-2 border-transparent hover:text-gray-900 hover:bg-gray-50 data-[state=active]:text-primary-600 data-[state=active]:border-primary-600 transition-all whitespace-nowrap"
    >
      {label}
      {count !== undefined && <span className="ml-2 px-2 py-0.5 text-xs bg-gray-100 rounded-full text-gray-600 group-data-[state=active]:bg-slate-50 group-data-[state=active]:text-primary-600">{count}</span>}
    </Tabs.Trigger>
  );
}

function DataTable({ headers, rows, emptyMessage }: { headers: string[], rows: (string | number)[][], emptyMessage: string }) {
  if (rows.length === 0) {
    return (
      <div className="p-12 text-center text-gray-500">
        <p>{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="bg-gray-50 border-b border-gray-200">
          <tr>
            {headers.map((h, i) => (
              <th key={i} className="px-6 py-3 font-medium text-gray-700 whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((row, i) => (
            <tr key={i} className="hover:bg-gray-50 transition-colors">
              {row.map((cell, j) => (
                <td key={j} className="px-6 py-3 text-gray-600 whitespace-nowrap">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function GSTR1Page() {
  return (
    <FeatureRouteGuard featureKey={FeatureKeys.REPORTS_GST}>
      <GSTR1PageContent />
    </FeatureRouteGuard>
  );
}
