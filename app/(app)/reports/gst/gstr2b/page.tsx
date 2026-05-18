'use client';

export const dynamic = 'force-dynamic';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { Download, FileText, RefreshCw, AlertCircle } from 'lucide-react';
import * as Tabs from '@radix-ui/react-tabs';
import { useToastContext } from '@/contexts/ToastContext';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

export default function GSTR2BPage() {
  const { business, user } = useAuth();
  const router = useRouter();
  const toast = useToastContext();
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<any>(null);
  
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [year, setYear] = useState(new Date().getFullYear());

  // Check if business has GSTIN
  const hasGSTIN = business?.gstin && business.gstin.trim().length > 0;

  // Redirect if GSTIN is missing
  useEffect(() => {
    if (business && !hasGSTIN) {
      const confirmed = window.confirm(
        'GSTR-2B reports require a business GSTIN. Would you like to add your GSTIN in Settings?'
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
        year: year.toString()
      });
      
      const res = await fetch(`/api/reports/gst/gstr2b?${query}`);
      const json = await res.json();
      if (res.ok) {
        setData(json);
      } else {
        console.error('GSTR-2B API Error:', json);
        const errorMessage = json.error || json.message || 'Failed to fetch GSTR-2B data';
        toast.error(`Failed to fetch GSTR-2B data: ${errorMessage}`);
      }
    } catch (error: any) {
      console.error('GSTR-2B Fetch Error:', error);
      toast.error(`Failed to fetch GSTR-2B data: ${error.message || 'Network error or server unavailable'}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (business && hasGSTIN) {
      fetchReport();
    }
  }, [business, hasGSTIN, month, year]);

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
              GSTR-2B reports are only available for businesses with a registered GSTIN. 
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

  const handleExport = async (format: 'csv' | 'json') => {
    if (!business) return;
    const query = new URLSearchParams({
      business_id: business.id,
      month: month.toString(),
      year: year.toString(),
      export: format
    });
    
    window.open(`/api/reports/gst/gstr2b?${query}`, '_blank');
  };

  return (
    
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">GSTR-2B Report</h1>
            <p className="text-sm text-gray-500">Auto-drafted ITC statement (Inward Supplies)</p>
          </div>
          <div className="flex gap-3">
            <button 
              onClick={() => handleExport('csv')}
              className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
            >
              <Download className="w-4 h-4" />
              Export CSV
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
              label="Total Inward Supplies" 
              value={`₹${data.summary.total_inward_supplies.toLocaleString('en-IN')}`} 
              subtext="Total Purchases"
              color="purple"
            />
            <SummaryCard 
              label="Total Tax Amount" 
              value={`₹${data.summary.total_tax_amount.toLocaleString('en-IN')}`} 
              subtext="IGST + CGST + SGST"
              color="blue"
            />
            <SummaryCard 
              label="ITC Eligible" 
              value={`₹${data.summary.total_itc_eligible.toLocaleString('en-IN')}`} 
              subtext="Input Tax Credit"
              color="green"
            />
            <SummaryCard 
              label="Total Bills" 
              value={data.summary.purchase_count} 
              subtext="Purchase Bills"
              color="orange"
            />
          </div>
        )}

        {/* Tabs */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <Tabs.Root defaultValue="b2b">
            <div className="border-b border-gray-200 overflow-x-auto">
              <Tabs.List className="flex min-w-max">
                <TabTrigger value="b2b" label="B2B Purchases" count={data?.b2b.length} />
                <TabTrigger value="imports" label="Imports" count={data?.imports.length} />
                <TabTrigger value="cdnr" label="CDNR" count={data?.cdnr.length} />
                <TabTrigger value="itc" label="ITC Summary" count={data?.itc_summary.length} />
              </Tabs.List>
            </div>

            <div className="p-0">
              <Tabs.Content value="b2b">
                <DataTable 
                  headers={['GSTIN', 'Supplier', 'Bill No', 'Date', 'Value', 'Taxable', 'IGST', 'CGST', 'SGST', 'ITC Eligible']}
                  rows={data?.b2b.map((i: any) => [
                    i.supplier_gstin, 
                    i.supplier_name, 
                    i.bill_number, 
                    i.bill_date, 
                    `₹${i.bill_value}`, 
                    `₹${i.taxable_value}`,
                    `₹${i.igst.toFixed(2)}`,
                    `₹${i.cgst.toFixed(2)}`,
                    `₹${i.sgst.toFixed(2)}`,
                    i.itc_eligible
                  ]) || []}
                  emptyMessage="No B2B purchases found"
                />
              </Tabs.Content>
              
              <Tabs.Content value="imports">
                <DataTable 
                   headers={['Port Code', 'Bill No', 'Date', 'Value', 'Taxable', 'IGST', 'Cess']}
                   rows={data?.imports.map((i: any) => [
                     i.port_code,
                     i.bill_number,
                     i.bill_date,
                     `₹${i.bill_value}`,
                     `₹${i.taxable_value}`,
                     `₹${i.igst.toFixed(2)}`,
                     `₹${i.cess.toFixed(2)}`
                   ]) || []}
                   emptyMessage="No import entries found"
                />
              </Tabs.Content>

              <Tabs.Content value="cdnr">
                <DataTable 
                   headers={['GSTIN', 'Supplier', 'Note No', 'Date', 'Type', 'Value', 'Taxable']}
                   rows={data?.cdnr.map((i: any) => [
                     i.supplier_gstin || '-',
                     i.supplier_name || '-',
                     i.note_number,
                     i.note_date,
                     i.note_type === 'C' ? 'Credit' : 'Debit',
                     `₹${i.note_value}`,
                     `₹${i.taxable_value}`
                   ]) || []}
                   emptyMessage="No credit/debit notes found"
                />
              </Tabs.Content>

              <Tabs.Content value="itc">
                <DataTable 
                   headers={['Description', 'IGST', 'CGST', 'SGST', 'Cess']}
                   rows={data?.itc_summary.map((i: any) => [
                     i.description,
                     `₹${i.igst.toFixed(2)}`,
                     `₹${i.cgst.toFixed(2)}`,
                     `₹${i.sgst.toFixed(2)}`,
                     `₹${i.cess.toFixed(2)}`
                   ]) || []}
                   emptyMessage="No ITC data available"
                />
              </Tabs.Content>
            </div>
          </Tabs.Root>
        </div>
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
      {count !== undefined && <span className="ml-2 px-2 py-0.5 text-xs bg-gray-100 rounded-full text-gray-600">{count}</span>}
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

