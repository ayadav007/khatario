'use client';

export const dynamic = 'force-dynamic';

import React, { useState, useEffect } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Loader2, CheckCircle, XCircle, AlertCircle, ShoppingCart, IndianRupee, Phone, Calendar, ExternalLink, Image as ImageIcon, Info } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { format } from 'date-fns';
import { Toast, ToastType } from '@/components/ui/Toast';
import { ConfirmDialog } from '@/components/whatsapp/ConfirmDialog';

function normalizePaymentStatus(status: string | null | undefined): string {
  return String(status || '').trim().toLowerCase();
}

/** Order marked paid (fully or partially) via DB aggregate / manual flows */
function hasProviderPaymentRecorded(status: string | null | undefined): boolean {
  const s = normalizePaymentStatus(status);
  return s === 'paid' || s === 'partial_paid' || s === 'partially_paid' || s === 'partial';
}

function ocrStatusPresentation(status: string | undefined) {
  switch (status) {
    case 'verified':
      return {
        Icon: CheckCircle,
        iconClass: 'text-green-600',
        cardClass: 'bg-green-50 border-green-200',
        title: 'Verified'
      };
    case 'requires_review':
      return {
        Icon: AlertCircle,
        iconClass: 'text-amber-600',
        cardClass: 'bg-amber-50 border-amber-200',
        title: 'Review needed'
      };
    case 'rejected':
      return {
        Icon: XCircle,
        iconClass: 'text-red-600',
        cardClass: 'bg-red-50 border-red-200',
        title: 'Rejected'
      };
    case 'awaiting_psp':
      return {
        Icon: Info,
        iconClass: 'text-blue-600',
        cardClass: 'bg-blue-50 border-blue-200',
        title: 'Awaiting payment provider'
      };
    case 'pending':
    default:
      return {
        Icon: Loader2,
        iconClass: 'text-gray-600 animate-spin',
        cardClass: 'bg-slate-50 border-gray-200',
        title: status?.replace(/_/g, ' ') || 'Pending'
      };
  }
}

export default function WhatsAppOrdersPage() {
  const { business } = useAuth();
  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState<any[]>([]);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string;
    message: string;
    onConfirm: () => void;
  } | null>(null);
  const [rejectDialog, setRejectDialog] = useState<{ orderId: string } | null>(null);
  const [rejectReasonInput, setRejectReasonInput] = useState('Payment could not be verified');
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 20;
  const totalCount = orders.length;
  const totalPages = Math.ceil(totalCount / PAGE_SIZE) || 1;
  const paginatedOrders = orders.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  useEffect(() => {
    const tp = Math.max(1, Math.ceil(orders.length / PAGE_SIZE) || 1);
    if (page > tp) setPage(tp);
  }, [orders.length, page]);

  const fetchOrders = async () => {
    if (!business?.id) return;
    
    setLoading(true);
    try {
      const res = await fetch(`/api/whatsapp/orders?business_id=${business.id}&status=draft`);
      const data = await res.json();
      if (res.ok) {
        setOrders(data.orders || []);
      }
    } catch (error) {
      console.error('Error fetching orders:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOrders();
  }, [business]);

  const handleApproveClick = (orderId: string) => {
    if (!business?.id) return;
    setConfirmDialog({
      title: 'Approve Order?',
      message: 'Are you sure you want to approve this payment and create an invoice?',
      onConfirm: () => {
        setConfirmDialog(null);
        void (async () => {
          setProcessingId(orderId);
          try {
            const res = await fetch(`/api/whatsapp/orders/${orderId}/approve`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ business_id: business.id }),
            });

            if (res.ok) {
              setToast({ message: 'Order approved and invoice created successfully!', type: 'success' });
              fetchOrders();
            } else {
              const data = await res.json();
              setToast({ message: data.error ? `Failed to approve: ${data.error}` : 'Failed to approve order', type: 'error' });
            }
          } catch (error) {
            console.error('Error approving order:', error);
            setToast({ message: 'Failed to approve order', type: 'error' });
          } finally {
            setProcessingId(null);
          }
        })();
      },
    });
  };

  const handleRejectClick = (orderId: string) => {
    if (!business?.id) return;
    setRejectReasonInput('Payment could not be verified');
    setRejectDialog({ orderId });
  };

  const submitReject = async () => {
    if (!business?.id || !rejectDialog) return;
    const orderId = rejectDialog.orderId;
    const reason = rejectReasonInput.trim() || 'Payment could not be verified';
    setRejectDialog(null);

    setProcessingId(orderId);
    try {
      const res = await fetch(`/api/whatsapp/orders/${orderId}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ business_id: business.id, reason }),
      });

      if (res.ok) {
        setToast({ message: 'Order rejected', type: 'success' });
        fetchOrders();
      } else {
        const data = await res.json();
        setToast({ message: data.error ? `Failed to reject: ${data.error}` : 'Failed to reject order', type: 'error' });
      }
    } catch (error) {
      console.error('Error rejecting order:', error);
      setToast({ message: 'Failed to reject order', type: 'error' });
    } finally {
      setProcessingId(null);
    }
  };

  return (
    
      <div className="max-w-6xl mx-auto space-y-6 pb-12">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Pending WhatsApp Orders</h1>
            <p className="text-gray-600">
              Verify payments from the WhatsApp AI agent: online checkout updates automatically when your payment provider confirms; manual UPI can use a screenshot.
            </p>
          </div>
          <Button onClick={fetchOrders} variant="secondary" disabled={loading}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
            Refresh
          </Button>
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="w-12 h-12 animate-spin text-primary-500" />
          </div>
        ) : orders.length === 0 ? (
          <Card padding="lg" className="text-center py-12">
            <ShoppingCart className="w-16 h-16 mx-auto text-gray-300 mb-4" />
            <h3 className="text-lg font-medium text-gray-900">No pending orders</h3>
            <p className="text-gray-500">All WhatsApp orders have been verified or there are no new orders.</p>
          </Card>
        ) : (
          <>
          <div className="grid gap-6">
            {paginatedOrders.map((order) => {
              const ocrUi = ocrStatusPresentation(order.ocr_status);
              const OcrIcon = ocrUi.Icon;
              return (
              <Card key={order.id} padding="none" className="overflow-hidden border-2 border-gray-200 hover:border-gray-300 transition-colors">
                <div className="flex flex-col md:flex-row">
                  {/* Order Details */}
                  <div className="flex-1 p-6 border-b md:border-b-0 md:border-r border-gray-100">
                    <div className="flex justify-between items-start mb-4">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <Badge variant="secondary" className="text-xs">{order.order_number}</Badge>
                          <span className="text-xs text-gray-500">{format(new Date(order.created_at), 'dd MMM yyyy, hh:mm a')}</span>
                        </div>
                        <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                          <ImageIcon className="w-5 h-5 text-gray-600" />
                          {order.customer_name || 'Anonymous Customer'}
                        </h3>
                        <div className="flex items-center gap-2 text-sm text-gray-600 mt-1">
                          <Phone className="w-4 h-4" />
                          {order.whatsapp_phone || order.customer_phone}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-xs text-gray-500 uppercase font-bold tracking-wider">Total Amount</div>
                        <div className="text-2xl font-black text-gray-900 flex items-center justify-end">
                          <IndianRupee className="w-5 h-5" />
                          {parseFloat(order.grand_total || 0).toLocaleString('en-IN')}
                        </div>
                      </div>
                    </div>

                    <div className="space-y-3 mb-6 bg-gray-50 p-4 rounded-xl">
                      <h4 className="text-xs font-bold text-gray-500 uppercase flex items-center gap-2">
                        <ShoppingCart className="w-3 h-3" />
                        Order Items
                      </h4>
                      <div className="divide-y divide-gray-200">
                        {order.items?.map((item: any, idx: number) => (
                          <div key={idx} className="py-2 flex justify-between text-sm">
                            <span className="font-medium text-gray-800">{item.item_name} <span className="text-gray-400 font-normal">x {parseFloat(item.qty || 0)}</span></span>
                            <span className="font-bold">₹{parseFloat(item.line_total || 0).toLocaleString('en-IN')}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="flex gap-3">
                      <Button 
                        onClick={() => handleApproveClick(order.id)} 
                        className="flex-1 bg-green-600 hover:bg-green-700 h-12"
                        disabled={processingId === order.id}
                      >
                        {processingId === order.id ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <CheckCircle className="w-4 h-4 mr-2" />}
                        Verify & Create Invoice
                      </Button>
                      <Button 
                        onClick={() => handleRejectClick(order.id)} 
                        variant="secondary" 
                        className="border-red-200 text-red-600 hover:bg-red-50 h-12"
                        disabled={processingId === order.id}
                      >
                        <XCircle className="w-4 h-4 mr-2" />
                        Reject
                      </Button>
                    </div>
                  </div>

                  {/* Screenshot & AI Analysis */}
                  <div className="w-full md:w-96 bg-gray-50 p-6">
                    <h4 className="text-xs font-bold text-gray-500 uppercase mb-4 flex items-center gap-2">
                      < ImageIcon className="w-3 h-3" />
                      Payment Verification
                    </h4>
                    
                    {hasProviderPaymentRecorded(order.payment_status) ? (
                      <div className="space-y-4">
                        <div className="p-4 rounded-xl border-2 border-green-200 bg-green-50 text-green-900">
                          <div className="flex items-center gap-2 mb-2">
                            <CheckCircle className="w-5 h-5 text-green-600 shrink-0" />
                            <span className="text-sm font-bold uppercase tracking-wider">
                              {normalizePaymentStatus(order.payment_status) === 'paid'
                                ? 'Payment received (online)'
                                : 'Partial payment received'}
                            </span>
                          </div>
                          <p className="text-xs text-green-800 mb-3">
                            Your payment provider reported a successful collection. No customer screenshot is required for this checkout flow.
                          </p>
                          <div className="text-xs space-y-2 text-green-900">
                            {order.payment_reference && (
                              <div className="flex justify-between gap-2 border-t border-green-200 pt-2">
                                <span className="text-green-800">Reference / UTR</span>
                                <span className="font-mono font-medium text-right break-all">{order.payment_reference}</span>
                              </div>
                            )}
                            {order.payment_method && (
                              <div className="flex justify-between gap-2">
                                <span className="text-green-800">Method</span>
                                <span className="font-medium truncate ml-2 max-w-[180px]">
                                  {String(order.payment_method).replace(/_/g, ' ')}
                                </span>
                              </div>
                            )}
                            {order.ocr_data?.verification_source && (
                              <div className="flex justify-between gap-2">
                                <span className="text-green-800">Source</span>
                                <span className="font-medium truncate ml-2 max-w-[180px]">
                                  {String(order.ocr_data.verification_source).replace(/_/g, ' ')}
                                </span>
                              </div>
                            )}
                          </div>
                        </div>
                        {order.payment_screenshot_url ? (
                          <p className="text-xs text-gray-500">
                            A screenshot was also attached; online confirmation above is sufficient to verify and invoice.
                          </p>
                        ) : null}
                      </div>
                    ) : order.payment_screenshot_url ? (
                      <div className="space-y-4">
                        <div className="relative group rounded-xl overflow-hidden border-2 border-gray-200 bg-white">
                          <img 
                            src={order.payment_screenshot_url} 
                            alt="Payment Screenshot" 
                            className="w-full h-48 object-cover cursor-pointer hover:scale-105 transition-transform"
                            onClick={() => window.open(order.payment_screenshot_url, '_blank')}
                          />
                          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                            <ExternalLink className="text-white w-8 h-8" />
                          </div>
                        </div>

                        <div className={`p-4 rounded-xl border-2 ${ocrUi.cardClass}`}>
                          <div className="flex items-center gap-2 mb-2">
                            <OcrIcon className={`w-4 h-4 ${ocrUi.iconClass}`} />
                            <span className="text-sm font-bold uppercase tracking-wider">
                              Payment proof: {ocrUi.title}
                            </span>
                          </div>
                          
                          {order.ocr_data && (
                            <div className="text-xs space-y-2 text-gray-700">
                              {order.ocr_data.verification_source && (
                                <div className="flex justify-between border-b border-gray-200 pb-2 mb-1">
                                  <span>Source:</span>
                                  <span className="font-medium truncate ml-2 max-w-[160px]">
                                    {String(order.ocr_data.verification_source).replace(/_/g, ' ')}
                                  </span>
                                </div>
                              )}
                              <div className="flex justify-between">
                                <span>Detected Amount:</span>
                                <span className="font-bold text-sm">
                                  {order.ocr_data.extractedAmount != null 
                                    ? `₹${parseFloat(order.ocr_data.extractedAmount || 0).toLocaleString('en-IN')}` 
                                    : 'N/A'}
                                </span>
                              </div>
                              <div className="flex justify-between">
                                <span>Confidence:</span>
                                <span className={`font-bold ${(order.ocr_data.effective_confidence ?? order.ocr_data.confidenceScore) > 80 ? 'text-green-600' : 'text-amber-600'}`}>
                                  {order.ocr_data.effective_confidence ?? order.ocr_data.confidenceScore ?? '—'}%
                                  {order.ocr_data.effective_confidence != null && order.ocr_data.confidenceScore != null && order.ocr_data.effective_confidence !== order.ocr_data.confidenceScore ? (
                                    <span className="text-gray-500 font-normal ml-1">(model {order.ocr_data.confidenceScore}%)</span>
                                  ) : null}
                                </span>
                              </div>
                              {order.ocr_data.extractedUPIId && (
                                <div className="flex justify-between">
                                  <span>Receiver UPI:</span>
                                  <span className="font-medium truncate ml-2">{order.ocr_data.extractedUPIId}</span>
                                </div>
                              )}
                              {order.ocr_data.validation_summary && (
                                <div className="mt-2 text-[10px] text-gray-600 border-t border-gray-200 pt-2">
                                  Validation: {order.ocr_data.validation_summary}
                                </div>
                              )}
                              {order.ocr_data.reason && (
                                <div className="mt-2 text-[10px] text-gray-500 italic border-t border-gray-200 pt-2">
                                  AI Note: {order.ocr_data.reason}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center min-h-[16rem] px-4 py-6 bg-white rounded-xl border-2 border-dashed border-gray-300 text-gray-500 text-center">
                        <ImageIcon className="w-12 h-12 mb-2 text-gray-400" />
                        <p className="text-sm font-medium text-gray-700 mb-1">No payment proof uploaded yet</p>
                        <p className="text-xs text-gray-500 max-w-xs">
                          If the customer paid using your <strong className="font-medium text-gray-700">payment link</strong>, this panel updates automatically when your provider notifies us (no screenshot needed).
                        </p>
                        <p className="text-xs text-gray-500 max-w-xs mt-2">
                          For manual UPI transfers, wait for the customer to send a screenshot in WhatsApp.
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </Card>
            );
            })}
          </div>
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4 pt-4 border-t">
              <p className="text-sm text-gray-600">
                Page {page} of {totalPages}
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="px-3 py-1.5 text-sm border rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
                >
                  Previous
                </button>
                <button
                  type="button"
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="px-3 py-1.5 text-sm border rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
                >
                  Next
                </button>
              </div>
            </div>
          )}
          </>
        )}
        {toast && (
          <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />
        )}
        <ConfirmDialog
          isOpen={!!confirmDialog}
          title={confirmDialog?.title || ''}
          message={confirmDialog?.message || ''}
          variant="default"
          confirmLabel="Approve"
          onConfirm={() => confirmDialog?.onConfirm()}
          onCancel={() => setConfirmDialog(null)}
        />
        {rejectDialog && (
          <div
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
            onClick={() => setRejectDialog(null)}
            role="dialog"
            aria-modal="true"
            aria-labelledby="reject-order-title"
          >
            <div
              className="bg-white rounded-lg shadow-xl max-w-md w-full p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 id="reject-order-title" className="text-lg font-semibold text-gray-900 mb-2">
                Reject Order?
              </h3>
              <p className="text-sm text-gray-600 mb-3">Please enter a reason for rejection.</p>
              <textarea
                value={rejectReasonInput}
                onChange={(e) => setRejectReasonInput(e.target.value)}
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-none text-sm"
                placeholder="Reason for rejection"
              />
              <div className="flex justify-end gap-3 mt-4">
                <Button variant="secondary" onClick={() => setRejectDialog(null)} disabled={processingId === rejectDialog.orderId}>
                  Cancel
                </Button>
                <Button
                  onClick={() => void submitReject()}
                  disabled={processingId === rejectDialog.orderId}
                  className="bg-red-600 hover:bg-red-700 text-white"
                >
                  Reject Order
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    
  );
}
