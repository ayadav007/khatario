'use client';

export const dynamic = 'force-dynamic';

/**
 * GSTR-2B Reconciliation Workspace
 * 
 * GST-law compliant reconciliation between:
 * - Books of accounts (Purchase Register)
 * - GSTR-2B data (from GST portal)
 * 
 * PRINCIPLES:
 * - GSTR-2B is the FINAL authority for ITC eligibility
 * - NO auto-adjustments
 * - All mismatches require USER decision
 * - Full audit trail maintained
 */

import React, { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Upload, RefreshCw, AlertCircle, CheckCircle, XCircle, FileDown, AlertTriangle } from 'lucide-react';
import { useToastContext } from '@/contexts/ToastContext';

type MatchStatus = 'MATCHED' | 'PARTIALLY_MATCHED' | 'MISSING_IN_2B' | 'ONLY_IN_2B' | 'NOT_ELIGIBLE';
type Decision = 'PENDING_SUPPLIER_CORRECTION' | 'ITC_ELIGIBLE_THIS_PERIOD' | 'ITC_DEFERRED_TO_FUTURE' | 'ITC_NOT_ELIGIBLE' | 'IGNORE';

interface ReconciliationInvoice {
  id: string;
  match_status: MatchStatus;
  supplier_gstin: string;
  invoice_number: string;
  invoice_date: string;
  document_type: string;
  books: {
    taxable_value: number;
    igst: number;
    cgst: number;
    sgst: number;
    cess: number;
    itc_amount: number;
  };
  gstr2b: {
    taxable_value: number;
    igst: number;
    cgst: number;
    sgst: number;
    cess: number;
    itc_eligibility: string;
  };
  differences: {
    taxable_value: number;
    igst: number;
    cgst: number;
    sgst: number;
    cess: number;
  };
  is_import_goods: boolean;
  is_import_services: boolean;
  is_credit_note: boolean;
  decision?: Decision;
  remarks?: string;
  decision_date?: string;
  eligible_itc_amount?: number;
  deferred_to_period?: string;
  decided_by_name?: string;
}

interface ReconciliationSummary {
  [key: string]: {
    count: number;
    total_books_itc: number;
    total_gstr2b_itc: number;
  };
}

export default function GSTR2BReconciliationPage() {
  const { business, user } = useAuth();
  const toast = useToastContext();
  const [loading, setLoading] = useState(false);
  const [reconciling, setReconciling] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [activeTab, setActiveTab] = useState<MatchStatus | 'ALL'>('ALL');
  const [filingPeriod, setFilingPeriod] = useState(() => {
    const now = new Date();
    const year = now.getFullYear();
    const month = (now.getMonth() + 1).toString().padStart(2, '0');
    return `${year}-${month}`;
  });
  
  const [invoices, setInvoices] = useState<ReconciliationInvoice[]>([]);
  const [summary, setSummary] = useState<ReconciliationSummary>({});
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (business) {
      fetchReconciliation();
    }
  }, [business, filingPeriod]);

  const fetchReconciliation = async () => {
    if (!business) return;
    
    setLoading(true);
    try {
      const res = await fetch(
        `/api/gst/gstr2b/reconcile?business_id=${business.id}&filing_period=${filingPeriod}`
      );
      const data = await res.json();
      
      if (res.ok) {
        setInvoices(data.invoices || []);
        setSummary(data.summary || {});
      } else {
        console.error('Error:', data.error);
        // If no reconciliation exists, summary will be empty - that's OK
        if (data.error && !data.error.includes('does not exist')) {
          toast.error(data.error);
        }
      }
    } catch (error) {
      console.error('Error fetching reconciliation:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleImport = async () => {
    if (!business || !selectedFile || !user) return;
    
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('business_id', business.id);
      formData.append('filing_period', filingPeriod);
      formData.append('file', selectedFile);
      formData.append('user_id', user.id);
      
      const res = await fetch('/api/gst/gstr2b/import', {
        method: 'POST',
        body: formData
      });
      
      const data = await res.json();
      
      if (res.ok) {
        toast.success(`Successfully imported ${data.invoices_imported} invoices`);
        setSelectedFile(null);
        // Trigger reconciliation after import
        await handleReconcile();
      } else {
        toast.error(`Import failed: ${data.error}`);
      }
    } catch (error) {
      console.error('Import error:', error);
      toast.error('Failed to import file');
    } finally {
      setUploading(false);
    }
  };

  const handleReconcile = async () => {
    if (!business) return;
    
    setReconciling(true);
    try {
      const res = await fetch('/api/gst/gstr2b/reconcile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: business.id,
          filing_period: filingPeriod
        })
      });
      
      const data = await res.json();
      
      if (res.ok) {
        toast.success(`Reconciliation completed. ${data.total_invoices} invoices processed.`);
        await fetchReconciliation();
      } else {
        toast.error(`Reconciliation failed: ${data.error}`);
      }
    } catch (error) {
      console.error('Reconciliation error:', error);
      toast.error('Failed to run reconciliation');
    } finally {
      setReconciling(false);
    }
  };

  const handleExport = async () => {
    if (!business) return;
    setExporting(true);
    try {
      // Split filing period into from/to dates for the export
      const [year, month] = filingPeriod.split('-');
      const fromDate = `${year}-${month}-01`;
      const toDate = new Date(parseInt(year), parseInt(month), 0).toISOString().split('T')[0];
      
      const res = await fetch(
        `/api/gst/gstr2b/export?business_id=${business.id}&from_date=${fromDate}&to_date=${toDate}&status=${activeTab.toLowerCase() === 'all' ? 'all' : activeTab}`
      );
      
      if (!res.ok) throw new Error('Export failed');
      
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `GSTR2B_Reconciliation_${filingPeriod}.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (error) {
      console.error('Export error:', error);
      toast.error('Failed to export reconciliation report');
    } finally {
      setExporting(false);
    }
  };

  const handleDecision = async (invoiceId: string, decision: Decision, remarks?: string, eligibleItc?: number, deferredPeriod?: string) => {
    if (!business || !user) return;
    
    try {
      const res = await fetch('/api/gst/gstr2b/decision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: business.id,
          reconciliation_id: invoiceId,
          decision,
          remarks,
          eligible_itc_amount: eligibleItc,
          deferred_to_period: deferredPeriod,
          decided_by_user_id: user.id
        })
      });
      
      const data = await res.json();
      
      if (res.ok) {
        await fetchReconciliation();
      } else {
        toast.error(`Failed to record decision: ${data.error}`);
      }
    } catch (error) {
      console.error('Error recording decision:', error);
      toast.error('Failed to record decision');
    }
  };

  const filteredInvoices = activeTab === 'ALL' 
    ? invoices 
    : invoices.filter(inv => inv.match_status === activeTab);

  const getStatusBadge = (status: MatchStatus) => {
    const badges = {
      'MATCHED': { color: 'bg-green-100 text-green-800', icon: CheckCircle, label: 'Matched' },
      'PARTIALLY_MATCHED': { color: 'bg-yellow-100 text-yellow-800', icon: AlertTriangle, label: 'Partially Matched' },
      'MISSING_IN_2B': { color: 'bg-orange-100 text-orange-800', icon: XCircle, label: 'Missing in 2B' },
      'ONLY_IN_2B': { color: 'bg-slate-100 text-primary-800', icon: AlertCircle, label: 'Only in 2B' },
      'NOT_ELIGIBLE': { color: 'bg-red-100 text-red-800', icon: XCircle, label: 'Not Eligible' }
    };
    
    const badge = badges[status];
    const Icon = badge.icon;
    
    return (
      <span className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium ${badge.color}`}>
        <Icon className="w-3 h-3" />
        {badge.label}
      </span>
    );
  };

  const tabs: { key: MatchStatus | 'ALL', label: string, count?: number }[] = [
    { key: 'ALL', label: 'All Invoices', count: invoices.length },
    { key: 'MATCHED', label: 'Matched', count: summary.MATCHED?.count || 0 },
    { key: 'PARTIALLY_MATCHED', label: 'Partially Matched', count: summary.PARTIALLY_MATCHED?.count || 0 },
    { key: 'MISSING_IN_2B', label: 'Missing in 2B', count: summary.MISSING_IN_2B?.count || 0 },
    { key: 'ONLY_IN_2B', label: 'Only in 2B', count: summary.ONLY_IN_2B?.count || 0 },
    { key: 'NOT_ELIGIBLE', label: 'Not Eligible', count: summary.NOT_ELIGIBLE?.count || 0 }
  ];

  return (
    
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-gray-900">GSTR-2B Reconciliation Workspace</h1>
          <p className="text-sm text-gray-600 mt-1">
            Reconcile purchase register with GSTR-2B data from GST portal
          </p>
        </div>

        {/* Compliance Warning Banner */}
        <div className="bg-amber-50 border-l-4 border-amber-400 p-4 rounded-r-lg">
          <div className="flex items-start">
            <AlertCircle className="w-5 h-5 text-amber-600 mt-0.5 mr-3 flex-shrink-0" />
            <div>
              <h3 className="text-sm font-semibold text-amber-800 mb-1">
                ITC Eligibility Based on GSTR-2B
              </h3>
              <p className="text-sm text-amber-700">
                As per GST law, GSTR-2B is the final authority for ITC eligibility. 
                Books of accounts are NOT the authority. All mismatches require your decision. 
                No automatic adjustments are made.
              </p>
            </div>
          </div>
        </div>

        {/* Filters & Actions */}
        <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-200">
          <div className="flex flex-wrap gap-4 items-end">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Filing Period</label>
              <input
                type="month"
                value={filingPeriod}
                onChange={(e) => setFilingPeriod(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 outline-none"
              />
            </div>

            <div className="flex-1">
              <label className="block text-xs font-medium text-gray-700 mb-1">Import GSTR-2B File</label>
              <div className="flex gap-2">
                <input
                  type="file"
                  accept=".json"
                  onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                  className="text-sm"
                />
                <button
                  onClick={handleImport}
                  disabled={!selectedFile || uploading}
                  className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 flex items-center gap-2"
                >
                  <Upload className="w-4 h-4" />
                  {uploading ? 'Uploading...' : 'Import'}
                </button>
              </div>
            </div>

            <button
              onClick={handleReconcile}
              disabled={reconciling}
              className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 disabled:opacity-50 flex items-center gap-2"
            >
              <RefreshCw className={`w-4 h-4 ${reconciling ? 'animate-spin' : ''}`} />
              {reconciling ? 'Reconciling...' : 'Run Reconciliation'}
            </button>

            <button
              onClick={handleExport}
              disabled={exporting || invoices.length === 0}
              className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 flex items-center gap-2"
            >
              <FileDown className="w-4 h-4" />
              {exporting ? 'Exporting...' : 'Export Excel'}
            </button>

            <button
              onClick={fetchReconciliation}
              disabled={loading}
              className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 disabled:opacity-50 flex items-center gap-2"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
        </div>

        {/* Summary Cards */}
        {Object.keys(summary).length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            {tabs.filter(t => t.key !== 'ALL').map(tab => (
              <div key={tab.key} className="bg-white p-4 rounded-xl shadow-sm border border-gray-200">
                <p className="text-xs text-gray-600 mb-1">{tab.label}</p>
                <p className="text-2xl font-bold text-gray-900">{tab.count || 0}</p>
                {summary[tab.key] && (
                  <p className="text-xs text-gray-500 mt-1">
                    ITC: ₹{summary[tab.key].total_gstr2b_itc.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Tabs */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200">
          <div className="border-b border-gray-200">
            <nav className="flex space-x-1 px-4" aria-label="Tabs">
              {tabs.map(tab => (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`
                    px-4 py-3 text-sm font-medium border-b-2 transition-colors
                    ${activeTab === tab.key
                      ? 'border-primary-500 text-primary-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                    }
                  `}
                >
                  {tab.label}
                  {tab.count !== undefined && (
                    <span className={`ml-2 px-2 py-0.5 rounded text-xs ${
                      activeTab === tab.key ? 'bg-slate-100 text-primary-800' : 'bg-gray-100 text-gray-600'
                    }`}>
                      {tab.count}
                    </span>
                  )}
                </button>
              ))}
            </nav>
          </div>

          {/* Invoice Table */}
          <div className="overflow-x-auto">
            {loading ? (
              <div className="p-8 text-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto"></div>
                <p className="mt-4 text-gray-600">Loading reconciliation data...</p>
              </div>
            ) : filteredInvoices.length === 0 ? (
              <div className="p-8 text-center text-gray-500">
                No invoices found. Import GSTR-2B data and run reconciliation.
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium text-gray-700">Status</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-700">Supplier GSTIN</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-700">Invoice #</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-700">Date</th>
                    <th className="px-4 py-3 text-right font-medium text-gray-700">Books ITC</th>
                    <th className="px-4 py-3 text-right font-medium text-gray-700">GSTR-2B ITC</th>
                    <th className="px-4 py-3 text-right font-medium text-gray-700">Difference</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-700">Decision</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-700">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filteredInvoices.map((invoice) => (
                    <InvoiceRow
                      key={invoice.id}
                      invoice={invoice}
                      onDecision={handleDecision}
                      getStatusBadge={getStatusBadge}
                    />
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    
  );
}

function InvoiceRow({
  invoice,
  onDecision,
  getStatusBadge
}: {
  invoice: ReconciliationInvoice;
  onDecision: (id: string, decision: Decision, remarks?: string, eligibleItc?: number, deferredPeriod?: string) => void;
  getStatusBadge: (status: MatchStatus) => React.ReactNode;
}) {
  const [showDecisionModal, setShowDecisionModal] = useState(false);
  const [decision, setDecision] = useState<Decision>(invoice.decision || 'PENDING_SUPPLIER_CORRECTION');
  const [remarks, setRemarks] = useState(invoice.remarks || '');
  const [eligibleItc, setEligibleItc] = useState(invoice.eligible_itc_amount?.toString() || '');
  const [deferredPeriod, setDeferredPeriod] = useState(invoice.deferred_to_period || '');

  const booksITC = invoice.books.itc_amount;
  const gstr2bITC = invoice.gstr2b.igst + invoice.gstr2b.cgst + invoice.gstr2b.sgst + invoice.gstr2b.cess;
  const difference = booksITC - gstr2bITC;

  const handleSaveDecision = () => {
    onDecision(
      invoice.id,
      decision,
      remarks || undefined,
      eligibleItc ? parseFloat(eligibleItc) : undefined,
      deferredPeriod || undefined
    );
    setShowDecisionModal(false);
  };

  return (
    <>
      <tr className="hover:bg-gray-50">
        <td className="px-4 py-3">{getStatusBadge(invoice.match_status)}</td>
        <td className="px-4 py-3 text-gray-900">{invoice.supplier_gstin}</td>
        <td className="px-4 py-3 text-gray-900 font-mono text-xs">{invoice.invoice_number}</td>
        <td className="px-4 py-3 text-gray-700">{invoice.invoice_date}</td>
        <td className="px-4 py-3 text-right text-gray-700">
          ₹{booksITC.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
        </td>
        <td className="px-4 py-3 text-right text-gray-700">
          ₹{gstr2bITC.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
        </td>
        <td className={`px-4 py-3 text-right font-medium ${
          Math.abs(difference) < 1 ? 'text-gray-700' : 'text-red-600'
        }`}>
          ₹{difference.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
        </td>
        <td className="px-4 py-3">
          {invoice.decision ? (
            <span className="text-xs text-gray-600">{invoice.decision.replace(/_/g, ' ')}</span>
          ) : (
            <span className="text-xs text-gray-400">No decision</span>
          )}
        </td>
        <td className="px-4 py-3">
          <button
            onClick={() => setShowDecisionModal(true)}
            className="text-primary-600 hover:text-primary-800 text-sm font-medium"
          >
            {invoice.decision ? 'Update' : 'Decide'}
          </button>
        </td>
      </tr>

      {/* Decision Modal */}
      {showDecisionModal && (
        <DecisionModal
          invoice={invoice}
          decision={decision}
          setDecision={setDecision}
          remarks={remarks}
          setRemarks={setRemarks}
          eligibleItc={eligibleItc}
          setEligibleItc={setEligibleItc}
          deferredPeriod={deferredPeriod}
          setDeferredPeriod={setDeferredPeriod}
          onSave={handleSaveDecision}
          onClose={() => setShowDecisionModal(false)}
        />
      )}
    </>
  );
}

function DecisionModal({
  invoice,
  decision,
  setDecision,
  remarks,
  setRemarks,
  eligibleItc,
  setEligibleItc,
  deferredPeriod,
  setDeferredPeriod,
  onSave,
  onClose
}: any) {
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900">Record Decision</h3>
          <p className="text-sm text-gray-600 mt-1">
            Invoice: {invoice.invoice_number} | Supplier: {invoice.supplier_gstin}
          </p>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Decision *</label>
            <select
              value={decision}
              onChange={(e) => setDecision(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 outline-none"
            >
              <option value="PENDING_SUPPLIER_CORRECTION">Pending Supplier Correction</option>
              <option value="ITC_ELIGIBLE_THIS_PERIOD">ITC Eligible This Period</option>
              <option value="ITC_DEFERRED_TO_FUTURE">ITC Deferred to Future</option>
              <option value="ITC_NOT_ELIGIBLE">ITC Not Eligible</option>
              <option value="IGNORE">Ignore (Informational Only)</option>
            </select>
          </div>

          {decision === 'ITC_ELIGIBLE_THIS_PERIOD' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Eligible ITC Amount (₹)
              </label>
              <input
                type="number"
                step="0.01"
                value={eligibleItc}
                onChange={(e) => setEligibleItc(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 outline-none"
              />
            </div>
          )}

          {decision === 'ITC_DEFERRED_TO_FUTURE' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Defer to Period (YYYY-MM)
              </label>
              <input
                type="month"
                value={deferredPeriod}
                onChange={(e) => setDeferredPeriod(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 outline-none"
              />
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Remarks</label>
            <textarea
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 outline-none"
              placeholder="Add any remarks or notes..."
            />
          </div>
        </div>

        <div className="p-6 border-t border-gray-200 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
          >
            Cancel
          </button>
          <button
            onClick={onSave}
            className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
          >
            Save Decision
          </button>
        </div>
      </div>
    </div>
  );
}

