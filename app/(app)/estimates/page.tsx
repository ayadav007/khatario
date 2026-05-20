'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState, useRef } from 'react';
import { Plus, FileText, Calendar, User, CheckCircle, XCircle, Clock, ArrowRight, Edit, Send, Share2, Download, X, Loader2, ChevronDown } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useToastContext } from '@/contexts/ToastContext';
import { useRouter, useSearchParams } from 'next/navigation';
import { ShareInvoiceModal } from '@/components/modals/ShareInvoiceModal';
import { safeJsonParse, getApiErrorMessage } from '@/lib/api-utils';
import { ListPageHeader } from '@/components/layout/ListPageHeader';
import { PageToolbar, PageToolbarChip } from '@/components/layout/PageToolbar';
import { SplitPaneLayout } from '@/components/layout/SplitPaneLayout';
import { Card } from '@/components/ui/Card';
import { clsx } from 'clsx';

interface Estimate {
  id: string;
  customer_id: string;
  customer_name: string;
  estimate_number: string;
  estimate_date: string;
  expiry_date: string | null;
  status: string;
  grand_total: number;
  converted_invoice_id: string | null;
}

interface EstimateDetails {
  id: string;
  invoice_number: string;
  invoice_date: string;
  expiry_date: string | null;
  estimate_status: string;
  customer_id: string;
  customer_name: string;
  customer_phone: string | null;
  customer_email: string | null;
  customer_gstin: string | null;
  billing_address: string | null;
  shipping_address: string | null;
  subtotal: number;
  discount_total: number;
  tax_total: number;
  grand_total: number;
  notes: string | null;
  terms: string | null;
  place_of_supply_state_code: string | null;
  items: Array<{
    id: string;
    item_name: string;
    quantity: number;
    unit_price: number;
    unit: string | null;
    discount_percent: number;
    tax_rate: number;
    tax_amount: number;
    line_total: number;
    hsn_sac: string | null;
  }>;
}

export default function EstimatesPage() {
  const router = useRouter();
  const { business, user } = useAuth();
  const toast = useToastContext();
  const searchParams = useSearchParams();
  const [estimates, setEstimates] = useState<Estimate[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0, totalPages: 0 });
  const [selectedEstimateId, setSelectedEstimateId] = useState<string | null>(null);
  const [estimateDetails, setEstimateDetails] = useState<EstimateDetails | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [showPdfView, setShowPdfView] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [showConvertMenu, setShowConvertMenu] = useState(false);
  const convertMenuRef = useRef<HTMLDivElement>(null);

  // Handle estimate selection from URL (e.g., from search results)
  useEffect(() => {
    const selectParam = searchParams.get('select');
    if (selectParam && selectParam !== selectedEstimateId) {
      setSelectedEstimateId(selectParam);
      setShowPdfView(false);
      fetchEstimateDetails(selectParam);
    }
  }, [searchParams, selectedEstimateId]);

  // Close convert menu when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (convertMenuRef.current && !convertMenuRef.current.contains(event.target as Node)) {
        setShowConvertMenu(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (business?.id) {
      fetchEstimates();
    }
  }, [business?.id, statusFilter, pagination.page]);

  useEffect(() => {
    if (business?.id) {
      // Reset to page 1 when filter changes
      setPagination(prev => ({ ...prev, page: 1 }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [business?.id, statusFilter]);

  async function fetchEstimates() {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      params.append('business_id', business!.id);
      params.append('user_id', user!.id); // ✅ Added missing user_id
      if (statusFilter) params.append('status', statusFilter);
      params.append('page', pagination.page.toString());
      params.append('limit', pagination.limit.toString());

      const response = await fetch(`/api/estimates?${params.toString()}`);
      const data = await response.json();
      setEstimates(data.estimates || []);
      if (data.pagination) {
        setPagination(data.pagination);
      }
    } catch (error) {
      console.error('Error fetching estimates:', error);
    } finally {
      setLoading(false);
    }
  }

  async function fetchEstimateDetails(estimateId: string) {
    try {
      setLoadingDetails(true);
      const response = await fetch(`/api/invoices/${estimateId}?user_id=${user?.id}`);
      if (response.ok) {
        const data = await response.json();
        // Map invoice data to EstimateDetails format
        const invoice = data.invoice;
        setEstimateDetails({
          id: invoice.id,
          invoice_number: invoice.invoice_number,
          invoice_date: invoice.invoice_date,
          expiry_date: invoice.expiry_date,
          estimate_status: invoice.estimate_status || invoice.status || 'draft',
          customer_id: invoice.customer_id,
          customer_name: invoice.customer_name || '',
          customer_phone: invoice.customer_phone || null,
          customer_email: invoice.customer_email || null,
          customer_gstin: invoice.customer_gstin || null,
          billing_address: invoice.customer_billing_address || null,
          shipping_address: invoice.customer_shipping_address || null,
          subtotal: Number(invoice.subtotal || 0),
          discount_total: Number(invoice.discount_total || 0),
          tax_total: Number(invoice.tax_total || 0),
          grand_total: Number(invoice.grand_total || 0),
          notes: invoice.notes || null,
          terms: invoice.terms || null,
          place_of_supply_state_code: invoice.place_of_supply_state_code || null,
          items: (invoice.items || []).map((item: any) => ({
            id: item.id,
            item_name: item.item_name || item.description || '',
            quantity: Number(item.quantity || 0),
            unit_price: Number(item.unit_price || 0),
            unit: item.unit || null,
            discount_percent: Number(item.discount_percent || 0),
            tax_rate: Number(item.tax_rate || 0),
            tax_amount: Number(item.tax_amount || 0),
            line_total: Number(item.line_total || 0),
            hsn_sac: item.hsn_sac || null,
          })),
        });
      } else {
        console.error('Error fetching estimate details');
        setEstimateDetails(null);
      }
    } catch (error) {
      console.error('Error fetching estimate details:', error);
      setEstimateDetails(null);
    } finally {
      setLoadingDetails(false);
    }
  }

  const handleEstimateSelect = (estimateId: string) => {
    setSelectedEstimateId(estimateId);
    setShowPdfView(false);
    fetchEstimateDetails(estimateId);
  };

  const handleCloseDetails = () => {
    setSelectedEstimateId(null);
    setEstimateDetails(null);
    setShowPdfView(false);
  };

  const handleStatusUpdate = async (newStatus: string) => {
    if (!selectedEstimateId || !user?.id) return;
    
    try {
      setUpdatingStatus(true);
      const response = await fetch(`/api/invoices/${selectedEstimateId}?user_id=${user.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ estimate_status: newStatus }),
      });

      if (response.ok) {
        // Refresh estimate details
        await fetchEstimateDetails(selectedEstimateId);
        // Also refresh the estimates list to update status badge
        await fetchEstimates();
      } else {
        const errorData = await safeJsonParse(response);
        console.error('Failed to update status:', errorData);
        toast.error(getApiErrorMessage(errorData, 'Failed to update status'));
      }
    } catch (error) {
      console.error('Error updating status:', error);
      toast.error('Error updating status. Please try again.');
    } finally {
      setUpdatingStatus(false);
    }
  };

  const handleSend = async () => {
    if (!selectedEstimateId || !user?.id) return;
    
    try {
      // First, update status to 'sent'
      setUpdatingStatus(true);
      const response = await fetch(`/api/invoices/${selectedEstimateId}?user_id=${user.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ estimate_status: 'sent' }),
      });

      if (response.ok) {
        // Refresh estimate details
        await fetchEstimateDetails(selectedEstimateId);
        // Also refresh the estimates list to update status badge
        await fetchEstimates();
        // Open share modal
        setShareModalOpen(true);
      } else {
        const errorData = await safeJsonParse(response);
        console.error('Failed to send estimate:', errorData);
        toast.error(getApiErrorMessage(errorData, 'Failed to send estimate'));
      }
    } catch (error) {
      console.error('Error sending estimate:', error);
      toast.error('Error sending estimate. Please try again.');
    } finally {
      setUpdatingStatus(false);
    }
  };

  const getStatusBadge = (status: string) => {
    const badges: Record<string, { color: string; icon: any; label: string }> = {
      draft: { color: 'bg-gray-100 text-gray-800', icon: Clock, label: 'Draft' },
      sent: { color: 'bg-slate-100 text-primary-800', icon: ArrowRight, label: 'Sent' },
      accepted: { color: 'bg-green-100 text-green-800', icon: CheckCircle, label: 'Accepted' },
      rejected: { color: 'bg-red-100 text-red-800', icon: XCircle, label: 'Rejected' },
      expired: { color: 'bg-orange-100 text-orange-800', icon: Clock, label: 'Expired' },
      converted: { color: 'bg-purple-100 text-purple-800', icon: CheckCircle, label: 'Converted' },
    };
    const badge = badges[status] || badges.draft;
    const Icon = badge.icon;
    return (
      <div className={`flex items-center space-x-2 px-3 py-1 rounded-full text-xs font-medium ${badge.color}`}>
        <Icon className="w-4 h-4" />
        <span>{badge.label}</span>
      </div>
    );
  };

  const isDetailOpen = selectedEstimateId !== null;

  const statusFilterRow = (
    <PageToolbar>
      {['', 'draft', 'sent', 'accepted', 'rejected', 'expired', 'converted'].map((status) => (
        <PageToolbarChip
          key={status}
          active={statusFilter === status}
          onClick={() => setStatusFilter(status)}
        >
          {status === '' ? 'All' : status.charAt(0).toUpperCase() + status.slice(1)}
        </PageToolbarChip>
      ))}
    </PageToolbar>
  );

  const toolbar = (
    <Card padding="md" className="mb-4">
      {statusFilterRow}
    </Card>
  );

  const paginationFooter =
    pagination.totalPages > 1 ? (
      <div className="flex justify-between items-center p-4 border-t border-gray-200 shrink-0">
        <p className="text-sm text-gray-600">
          Page {pagination.page} of {pagination.totalPages} ({pagination.total} estimates)
        </p>
        <div className="flex space-x-2">
          <button
            type="button"
            onClick={() => setPagination((prev) => ({ ...prev, page: Math.max(1, prev.page - 1) }))}
            disabled={pagination.page === 1}
            className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Previous
          </button>
          <button
            type="button"
            onClick={() =>
              setPagination((prev) => ({ ...prev, page: Math.min(prev.totalPages, prev.page + 1) }))
            }
            disabled={pagination.page === pagination.totalPages}
            className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Next
          </button>
        </div>
      </div>
    ) : null;

  const estimatesListInner =
    loading ? (
      <div className="p-12 text-center">
        <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
      </div>
    ) : estimates.length === 0 ? (
      <div className="p-12 text-center">
        <FileText className="w-12 h-12 text-gray-400 mx-auto mb-4" />
        <p className="text-gray-600">No estimates found</p>
        <button
          type="button"
          onClick={() => router.push('/invoices/new?type=proforma_invoice')}
          className="mt-4 px-6 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition"
        >
          Create Your First Estimate
        </button>
      </div>
    ) : isDetailOpen ? (
      <div className="divide-y divide-gray-200">
        {estimates.map((estimate) => (
          <div
            key={estimate.id}
            role="button"
            tabIndex={0}
            onClick={() => handleEstimateSelect(estimate.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                handleEstimateSelect(estimate.id);
              }
            }}
            className={clsx(
              'p-4 cursor-pointer transition-colors hover:bg-gray-50',
              selectedEstimateId === estimate.id && 'bg-slate-50'
            )}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3 flex-1 min-w-0">
                <input
                  type="checkbox"
                  onClick={(e) => e.stopPropagation()}
                  className="mt-1 h-4 w-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500"
                />
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-gray-900 mb-1">{estimate.customer_name}</div>
                  <div className="flex items-center gap-2 text-sm text-gray-600 flex-wrap">
                    <span className="font-medium text-gray-700">{estimate.estimate_number}</span>
                    <span>•</span>
                    <span>{new Date(estimate.estimate_date).toLocaleDateString()}</span>
                    {estimate.expiry_date && (
                      <>
                        <span>•</span>
                        <span>Expires: {new Date(estimate.expiry_date).toLocaleDateString()}</span>
                      </>
                    )}
                  </div>
                  <div className="mt-2">{getStatusBadge(estimate.status)}</div>
                </div>
              </div>
              <div className="flex-shrink-0">
                <div className="text-right">
                  <div className="font-semibold text-gray-900 text-lg">
                    ₹{Number(estimate.grand_total || 0).toFixed(2)}
                  </div>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    ) : (
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Estimate #</th>
              <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Customer</th>
              <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Date</th>
              <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Expiry</th>
              <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Amount</th>
              <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Status</th>
              <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Actions</th>
            </tr>
          </thead>
          <tbody>
            {estimates.map((estimate) => (
              <tr
                key={estimate.id}
                className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer transition-colors"
                onClick={() => handleEstimateSelect(estimate.id)}
              >
                <td className="py-4 px-4">
                  <div className="flex items-center space-x-2">
                    <FileText className="w-4 h-4 text-gray-400" />
                    <span className="text-sm font-medium text-gray-900">{estimate.estimate_number}</span>
                  </div>
                </td>
                <td className="py-4 px-4">
                  <div className="flex items-center space-x-2">
                    <User className="w-4 h-4 text-gray-400" />
                    <span className="text-sm text-gray-700">{estimate.customer_name}</span>
                  </div>
                </td>
                <td className="py-4 px-4">
                  <div className="flex items-center space-x-2 text-sm text-gray-600">
                    <Calendar className="w-4 h-4" />
                    <span>{new Date(estimate.estimate_date).toLocaleDateString()}</span>
                  </div>
                </td>
                <td className="py-4 px-4">
                  {estimate.expiry_date ? (
                    <span className="text-sm text-gray-600">
                      {new Date(estimate.expiry_date).toLocaleDateString()}
                    </span>
                  ) : (
                    <span className="text-sm text-gray-400">-</span>
                  )}
                </td>
                <td className="py-4 px-4">
                  <span className="text-sm font-semibold text-gray-900">
                    ₹{Number(estimate.grand_total || 0).toFixed(2)}
                  </span>
                </td>
                <td className="py-4 px-4">{getStatusBadge(estimate.status)}</td>
                <td className="py-4 px-4">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleEstimateSelect(estimate.id);
                    }}
                    className="text-sm text-primary-600 hover:text-primary-700 font-medium"
                  >
                    View
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );

  const fullList = (
    <Card padding="none" className="overflow-hidden rounded-xl shadow-sm border border-gray-200">
      {estimatesListInner}
      {paginationFooter}
    </Card>
  );

  const compactList = (
    <Card padding="none" className="overflow-hidden h-full min-h-0 flex flex-col rounded-xl shadow-sm border border-gray-200">
      <div className="p-3 border-b border-gray-200 shrink-0 hidden md:block">{statusFilterRow}</div>
      <div className="flex-1 min-h-0 overflow-y-auto">{estimatesListInner}</div>
      {paginationFooter}
    </Card>
  );

  return (
    <div className="space-y-3 md:space-y-6 h-full min-h-0 flex flex-col">
      <ListPageHeader
        title="Estimates"
        description="Create quotes and convert them to invoices or sales orders"
        actions={
          <button
            type="button"
            onClick={() => router.push('/invoices/new?type=proforma_invoice')}
            className="hidden md:flex items-center space-x-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition h-10"
          >
            <Plus className="w-5 h-5" />
            <span>New Estimate</span>
          </button>
        }
      />

      <div className="flex-1 min-h-0 flex flex-col">
        <SplitPaneLayout
          className="flex-1 min-h-0"
          isDetailOpen={isDetailOpen}
          onCloseDetail={handleCloseDetails}
          toolbarSlot={toolbar}
          listSlot={isDetailOpen ? compactList : fullList}
          detailSlot={
          selectedEstimateId ? (
            <div className="h-full min-h-0 bg-white rounded-xl shadow-sm border border-gray-200 flex flex-col">
          {loadingDetails ? (
            <div className="flex items-center justify-center flex-1">
              <Loader2 className="w-6 h-6 animate-spin text-primary-600" />
            </div>
          ) : estimateDetails ? (
            <>
              {/* Header - More Compact */}
              <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-bold text-gray-900">{estimateDetails.invoice_number}</h2>
                  <p className="text-sm text-gray-600">₹{Number(estimateDetails.grand_total || 0).toFixed(2)}</p>
                </div>
                <div className="flex items-center gap-3">
                  {/* PDF Toggle */}
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-600">Show PDF View</span>
                    <button
                      onClick={() => setShowPdfView(!showPdfView)}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                        showPdfView ? 'bg-primary-600' : 'bg-gray-300'
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                          showPdfView ? 'translate-x-6' : 'translate-x-1'
                        }`}
                      />
                    </button>
                  </div>
                  <button
                    onClick={handleCloseDetails}
                    className="p-1.5 hover:bg-gray-100 rounded-lg transition"
                  >
                    <X className="w-5 h-5 text-gray-500" />
                  </button>
                </div>
              </div>

              {/* Action Buttons - More Compact */}
              <div className="px-4 py-2.5 border-b border-gray-200 flex items-center gap-2 flex-wrap">
                <button
                  onClick={() => router.push(`/invoices/new?edit=${selectedEstimateId}&type=proforma_invoice`)}
                  className="px-2.5 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 flex items-center gap-1.5"
                >
                  <Edit className="w-4 h-4" />
                  Edit
                </button>
                <button
                  onClick={handleSend}
                  disabled={updatingStatus || estimateDetails.estimate_status === 'converted'}
                  className="px-2.5 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Send className="w-4 h-4" />
                  Send
                </button>
                <button
                  onClick={() => setShareModalOpen(true)}
                  className="px-2.5 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 flex items-center gap-1.5"
                >
                  <Share2 className="w-4 h-4" />
                  Share
                </button>
                <button
                  onClick={() => window.open(`/api/invoices/${selectedEstimateId}/pdf?user_id=${user?.id}`, '_blank')}
                  className="px-2.5 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 flex items-center gap-1.5"
                >
                  <Download className="w-4 h-4" />
                  PDF
                </button>
                {/* Show convert options based on status */}
                {(() => {
                  const status = estimateDetails.estimate_status;
                  // Can convert if: draft, sent, or accepted
                  // Cannot convert if: rejected, expired, or converted
                  const canConvert = ['draft', 'sent', 'accepted'].includes(status);
                  
                  if (!canConvert) {
                    return (
                      <div className="px-2.5 py-1.5 text-xs text-gray-500 border border-gray-200 rounded-lg bg-gray-50">
                        {status === 'converted' && 'Already Converted'}
                        {status === 'rejected' && 'Cannot Convert (Rejected)'}
                        {status === 'expired' && 'Cannot Convert (Expired)'}
                      </div>
                    );
                  }
                  
                  return (
                    <div className="relative" ref={convertMenuRef}>
                      <button
                        onClick={() => setShowConvertMenu(!showConvertMenu)}
                        className="px-2.5 py-1.5 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 flex items-center gap-1.5"
                      >
                        <ArrowRight className="w-4 h-4" />
                        Convert
                        <ChevronDown className="w-4 h-4" />
                      </button>
                      
                      {showConvertMenu && (
                        <div className="absolute right-0 mt-1 w-48 bg-white border border-gray-200 rounded-lg shadow-lg z-50">
                          <button
                            onClick={() => {
                              setShowConvertMenu(false);
                              router.push(`/invoices/new?convert_from=${selectedEstimateId}&type=tax_invoice`);
                            }}
                            className="w-full text-left px-4 py-2.5 hover:bg-gray-50 flex items-center gap-2 text-sm border-b border-gray-100"
                          >
                            <FileText className="w-4 h-4 text-primary-600" />
                            <span>Convert to Invoice</span>
                          </button>
                          <button
                            onClick={() => {
                              setShowConvertMenu(false);
                              router.push(`/sales-orders/new?convert_from=${selectedEstimateId}`);
                            }}
                            className="w-full text-left px-4 py-2.5 hover:bg-gray-50 flex items-center gap-2 text-sm"
                          >
                            <FileText className="w-4 h-4 text-green-600" />
                            <span>Convert to Sales Order</span>
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>

              {/* Content Area - Optimized for Space */}
              <div className="flex-1 overflow-y-auto min-h-0">
                {showPdfView ? (
                  /* PDF View */
                  <iframe
                    src={`/api/invoices/${selectedEstimateId}/pdf?user_id=${user?.id}`}
                    className="w-full h-full border-0"
                    title="Estimate PDF"
                  />
                ) : (
                  /* Details View - Reduced Padding */
                  <div className="p-4 space-y-4">
                    {/* Summary - More Compact */}
                    <div>
                      <h3 className="text-sm font-semibold text-gray-900 mb-2">Summary</h3>
                      <div className="bg-gray-50 rounded-lg p-3 space-y-1.5">
                        <div className="flex justify-between items-center">
                          <span className="text-sm text-gray-600">Status</span>
                          {estimateDetails.estimate_status !== 'converted' ? (
                            <div className="relative">
                              <select
                                value={estimateDetails.estimate_status || 'draft'}
                                onChange={(e) => handleStatusUpdate(e.target.value)}
                                disabled={updatingStatus}
                                className="text-xs font-medium px-2.5 py-1 rounded border border-gray-300 bg-white focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-50 disabled:cursor-not-allowed appearance-none pr-6"
                              >
                                <option value="draft">Draft</option>
                                <option value="sent">Sent</option>
                                <option value="accepted">Accepted</option>
                                <option value="rejected">Rejected</option>
                                <option value="expired">Expired</option>
                              </select>
                              <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400 pointer-events-none" />
                            </div>
                          ) : (
                            getStatusBadge(estimateDetails.estimate_status || 'draft')
                          )}
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-sm text-gray-600">Total</span>
                          <span className="text-sm font-semibold">₹{Number(estimateDetails.grand_total || 0).toFixed(2)}</span>
                        </div>
                      </div>
                    </div>

                    {/* Key Information - More Compact */}
                    <div>
                      <h3 className="text-sm font-semibold text-gray-900 mb-2">Key Information</h3>
                      <div className="space-y-1.5 text-sm">
                        <div className="flex justify-between py-1">
                          <span className="text-gray-600">Estimate Number</span>
                          <span className="font-medium">{estimateDetails.invoice_number}</span>
                        </div>
                        <div className="flex justify-between py-1">
                          <span className="text-gray-600">Estimate Date</span>
                          <span className="font-medium">{new Date(estimateDetails.invoice_date).toLocaleDateString()}</span>
                        </div>
                        {estimateDetails.expiry_date && (
                          <div className="flex justify-between py-1">
                            <span className="text-gray-600">Expiry Date</span>
                            <span className="font-medium">{new Date(estimateDetails.expiry_date).toLocaleDateString()}</span>
                          </div>
                        )}
                        {estimateDetails.place_of_supply_state_code && (
                          <div className="flex justify-between py-1">
                            <span className="text-gray-600">Place of Supply</span>
                            <span className="font-medium">{estimateDetails.place_of_supply_state_code}</span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Customer Details - More Compact */}
                    <div>
                      <h3 className="text-sm font-semibold text-gray-900 mb-2">Customer Details</h3>
                      <div className="space-y-1.5 text-sm">
                        <div className="py-1">
                          <span className="text-gray-600">Name: </span>
                          <span className="font-medium">{estimateDetails.customer_name}</span>
                        </div>
                        {estimateDetails.customer_phone && (
                          <div className="py-1">
                            <span className="text-gray-600">Phone: </span>
                            <span className="font-medium">{estimateDetails.customer_phone}</span>
                          </div>
                        )}
                        {estimateDetails.customer_email && (
                          <div className="py-1">
                            <span className="text-gray-600">Email: </span>
                            <span className="font-medium">{estimateDetails.customer_email}</span>
                          </div>
                        )}
                        {estimateDetails.billing_address && (
                          <div className="py-1">
                            <span className="text-gray-600">Billing Address: </span>
                            <span className="font-medium">{estimateDetails.billing_address}</span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Items - More Compact */}
                    <div>
                      <h3 className="text-sm font-semibold text-gray-900 mb-2">
                        Items ({estimateDetails.items?.length || 0})
                      </h3>
                      <div className="border border-gray-200 rounded-lg overflow-hidden">
                        <table className="w-full text-sm">
                          <thead className="bg-gray-50">
                            <tr>
                              <th className="text-left py-1.5 px-3 font-semibold text-gray-700">Item</th>
                              <th className="text-right py-1.5 px-3 font-semibold text-gray-700">Qty</th>
                              <th className="text-right py-1.5 px-3 font-semibold text-gray-700">Price</th>
                              <th className="text-right py-1.5 px-3 font-semibold text-gray-700">Amount</th>
                            </tr>
                          </thead>
                          <tbody>
                            {estimateDetails.items?.map((item, idx) => (
                              <tr key={item.id} className="border-t border-gray-100">
                                <td className="py-1.5 px-3">
                                  <div>
                                    <div className="font-medium">{item.item_name}</div>
                                    {item.hsn_sac && (
                                      <div className="text-xs text-gray-500">HSN: {item.hsn_sac}</div>
                                    )}
                                  </div>
                                </td>
                                <td className="py-1.5 px-3 text-right">{item.quantity} {item.unit || 'pcs'}</td>
                                <td className="py-1.5 px-3 text-right">₹{Number(item.unit_price || 0).toFixed(2)}</td>
                                <td className="py-1.5 px-3 text-right font-medium">₹{Number(item.line_total || 0).toFixed(2)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    {/* Totals - More Compact */}
                    <div>
                      <div className="border-t border-gray-200 pt-3 space-y-1.5 text-sm">
                        <div className="flex justify-between">
                          <span className="text-gray-600">Subtotal</span>
                          <span className="font-medium">₹{Number(estimateDetails.subtotal || 0).toFixed(2)}</span>
                        </div>
                        {estimateDetails.discount_total > 0 && (
                          <div className="flex justify-between text-red-600">
                            <span>Discount</span>
                            <span>- ₹{Number(estimateDetails.discount_total || 0).toFixed(2)}</span>
                          </div>
                        )}
                        {estimateDetails.tax_total > 0 && (
                          <div className="flex justify-between">
                            <span className="text-gray-600">Tax</span>
                            <span className="font-medium">₹{Number(estimateDetails.tax_total || 0).toFixed(2)}</span>
                          </div>
                        )}
                        <div className="flex justify-between pt-2 border-t border-gray-200 font-bold text-base">
                          <span>Grand Total</span>
                          <span>₹{Number(estimateDetails.grand_total || 0).toFixed(2)}</span>
                        </div>
                      </div>
                    </div>

                    {/* Notes - More Compact */}
                    {estimateDetails.notes && (
                      <div>
                        <h3 className="text-sm font-semibold text-gray-900 mb-2">Notes</h3>
                        <p className="text-sm text-gray-600">{estimateDetails.notes}</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="flex items-center justify-center flex-1">
              <p className="text-gray-500">Failed to load estimate details</p>
            </div>
          )}
            </div>
          ) : null
        }
        />
      </div>

      {/* Share Modal */}
      {shareModalOpen && selectedEstimateId && estimateDetails && (
        <ShareInvoiceModal
          invoiceId={selectedEstimateId}
          invoiceNumber={estimateDetails.invoice_number}
          customerEmail={estimateDetails.customer_email || undefined}
          customerPhone={estimateDetails.customer_phone || undefined}
          onClose={() => setShareModalOpen(false)}
        />
      )}
    </div>
  );
}

