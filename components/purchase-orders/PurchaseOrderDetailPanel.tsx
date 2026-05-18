'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowRight,
  ChevronDown,
  Download,
  Edit,
  ExternalLink,
  FileText,
  Loader2,
  Mail,
  MessageSquare,
  MoreHorizontal,
  Paperclip,
  Printer,
  X,
} from 'lucide-react';
import { clsx } from 'clsx';
import { Button } from '@/components/ui/Button';
import { useToastContext } from '@/contexts/ToastContext';
import { useAuth } from '@/contexts/AuthContext';
import { SendDocumentEmailModal } from '@/components/email/SendDocumentEmailModal';
import {
  PurchaseOrderSummaryView,
  type PurchaseOrderLineItem,
} from '@/components/purchase-orders/PurchaseOrderSummaryView';
import { SlideOverPanel } from '@/components/ui/SlideOverPanel';
import { PurchaseOrderAttachmentsPanel } from '@/components/purchase-orders/PurchaseOrderAttachmentsPanel';
import { PurchaseOrderCommentsHistoryPanel } from '@/components/purchase-orders/PurchaseOrderCommentsHistoryPanel';

interface PurchaseOrderDetailPanelProps {
  orderId: string;
  onClose: () => void;
  onConverted?: () => void;
}

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    draft: 'DRAFT',
    confirmed: 'OPEN',
    partially_fulfilled: 'PARTIALLY RECEIVED',
    fulfilled: 'CLOSED',
    cancelled: 'CANCELLED',
  };
  return labels[status] || status.toUpperCase();
}

function statusColorClass(status: string): string {
  const map: Record<string, string> = {
    draft: 'text-gray-700',
    confirmed: 'text-blue-700',
    partially_fulfilled: 'text-amber-700',
    fulfilled: 'text-green-700',
    cancelled: 'text-red-700',
  };
  return map[status] || 'text-gray-700';
}

function receiveStatusLabel(status: string): string {
  if (status === 'fulfilled') return 'RECEIVED';
  if (status === 'partially_fulfilled') return 'PARTIALLY RECEIVED';
  if (status === 'cancelled') return '—';
  if (status === 'confirmed') return 'YET TO BE RECEIVED';
  return 'DRAFT';
}

function billedStatusLabel(convertedPurchaseId: string | null, status: string): string {
  if (convertedPurchaseId) return 'BILLED';
  if (status === 'fulfilled') return 'BILLED';
  return 'YET TO BILL';
}

export function PurchaseOrderDetailPanel({
  orderId,
  onClose,
  onConverted,
}: PurchaseOrderDetailPanelProps) {
  const router = useRouter();
  const toast = useToastContext();
  const { business, user } = useAuth();
  const [order, setOrder] = useState<any>(null);
  const [items, setItems] = useState<PurchaseOrderLineItem[]>([]);
  const [html, setHtml] = useState('');
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showPdf, setShowPdf] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [converting, setConverting] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [emailModalOpen, setEmailModalOpen] = useState(false);
  const [attachmentsOpen, setAttachmentsOpen] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0);

  const fetchOrder = useCallback(async () => {
    setLoading(true);
    setPreviewError(null);
    try {
      const resDoc = await fetch(`/api/documents/purchase_orders/${orderId}`, {
        credentials: 'include',
      });
      const dataDoc = await resDoc.json();
      if (!resDoc.ok) {
        setOrder(null);
        setPreviewError(dataDoc.error || 'Failed to load purchase order');
        return;
      }
      setOrder(dataDoc.document);
      setItems(Array.isArray(dataDoc.items) ? dataDoc.items : []);

      const resPreview = await fetch(`/api/documents/purchase_orders/${orderId}/preview`, {
        credentials: 'include',
      });
      const dataPreview = await resPreview.json();
      if (!resPreview.ok) {
        setHtml('');
        setPreviewError(dataPreview.error || 'Preview could not be generated');
        return;
      }
      setHtml(typeof dataPreview.html === 'string' ? dataPreview.html : '');
      if (!dataPreview.html) {
        setPreviewError('Preview returned empty content');
      }
    } catch {
      setPreviewError('Failed to load document preview');
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => {
    setShowPdf(true);
    fetchOrder();
  }, [orderId, fetchOrder]);

  useEffect(() => {
    if (commentsOpen) {
      setHistoryRefreshKey((k) => k + 1);
    }
  }, [commentsOpen]);

  const handlePrint = () => {
    if (!html) return;
    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(html);
      printWindow.document.close();
      printWindow.focus();
      setTimeout(() => printWindow.print(), 500);
    }
  };

  const handleDownloadPdf = async () => {
    try {
      setDownloading(true);
      const res = await fetch(`/api/documents/purchase_orders/${orderId}/pdf`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to generate PDF');
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${order?.order_number || 'purchase-order'}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch {
      toast.error('Failed to download PDF');
    } finally {
      setDownloading(false);
    }
  };

  const handleConvert = async () => {
    if (!confirm('Convert this purchase order to a purchase? Stock will be added.')) return;
    setConverting(true);
    try {
      const res = await fetch(`/api/purchase-orders/${orderId}/convert`, { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        toast.success(
          `Purchase order converted! Purchase: ${data.purchase?.bill_number || data.purchase?.id}`
        );
        onConverted?.();
        fetchOrder();
      } else {
        toast.error(data.error || 'Failed to convert');
      }
    } catch {
      toast.error('Error converting purchase order');
    } finally {
      setConverting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-full min-h-[480px] items-center justify-center rounded-xl border border-border bg-white">
        <Loader2 className="h-8 w-8 animate-spin text-primary-600" />
      </div>
    );
  }

  if (!order) {
    return (
      <div className="flex h-full min-h-[480px] flex-col items-center justify-center gap-3 rounded-xl border border-border bg-white p-8">
        <FileText className="h-10 w-10 text-gray-400" />
        <p className="text-sm text-text-secondary">{previewError || 'Purchase order not found'}</p>
        <Button variant="secondary" size="sm" onClick={onClose}>
          Close
        </Button>
      </div>
    );
  }

  const canConvert =
    order.status !== 'fulfilled' && order.status !== 'cancelled' && !order.converted_purchase_id;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-white shadow-sm">
      {/* Header */}
      <div className="shrink-0 border-b border-border px-4 py-3 md:px-5">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-xl font-bold text-gray-900 truncate">{order.order_number}</h2>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => setAttachmentsOpen(true)}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border text-gray-600 hover:bg-gray-50"
              aria-label="Attachments"
              title="Attachments"
            >
              <Paperclip className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setCommentsOpen(true)}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border text-gray-600 hover:bg-gray-50"
              aria-label="Comments and history"
              title="Comments & history"
            >
              <MessageSquare className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => router.push(`/purchase-orders/new?edit=${orderId}`)}
          >
            <Edit className="mr-1.5 h-4 w-4" />
            Edit
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setEmailModalOpen(true)}>
            <Mail className="mr-1.5 h-4 w-4" />
            Send Email
          </Button>
          <Button variant="secondary" size="sm" onClick={handlePrint} disabled={!html}>
            <Printer className="mr-1.5 h-4 w-4" />
            Print
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleDownloadPdf}
            isLoading={downloading}
          >
            <Download className="mr-1.5 h-4 w-4" />
            PDF
          </Button>
          {canConvert && (
            <Button variant="secondary" size="sm" onClick={handleConvert} isLoading={converting}>
              <ArrowRight className="mr-1.5 h-4 w-4" />
              Convert to Purchase
            </Button>
          )}
          {order.converted_purchase_id && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => router.push(`/purchases/${order.converted_purchase_id}`)}
            >
              <ExternalLink className="mr-1.5 h-4 w-4" />
              View Purchase
            </Button>
          )}
          <div className="relative ml-auto">
            <button
              type="button"
              onClick={() => setMoreOpen((v) => !v)}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border text-gray-600 hover:bg-gray-50"
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
            {moreOpen && (
              <div className="absolute right-0 top-full z-20 mt-1 w-48 rounded-lg border border-border bg-white py-1 shadow-lg">
                <button
                  type="button"
                  className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
                  onClick={() => {
                    setMoreOpen(false);
                    router.push(`/purchase-orders/${orderId}`);
                  }}
                >
                  Open full page
                </button>
              </div>
            )}
          </div>
        </div>

        {order.converted_purchase_id && (
          <button
            type="button"
            className="mt-3 flex w-full items-center justify-between rounded-lg border border-border bg-gray-50 px-3 py-2 text-sm text-gray-700 hover:bg-gray-100"
            onClick={() => router.push(`/purchases/${order.converted_purchase_id}`)}
          >
            <span>Bills 1</span>
            <ChevronDown className="h-4 w-4 -rotate-90" />
          </button>
        )}

        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-text-secondary">
          <span>
            Receive status:{' '}
            <span className="font-semibold uppercase text-gray-900">
              {receiveStatusLabel(order.status)}
            </span>
          </span>
          <span>
            Bill status:{' '}
            <span
              className={clsx(
                'font-semibold uppercase',
                order.converted_purchase_id || order.status === 'fulfilled'
                  ? 'text-green-700'
                  : 'text-gray-900'
              )}
            >
              {billedStatusLabel(order.converted_purchase_id, order.status)}
            </span>
          </span>
          <span className={clsx('font-semibold uppercase', statusColorClass(order.status))}>
            {statusLabel(order.status)}
          </span>
        </div>

        <div className="mt-3 flex items-center justify-end gap-2">
          <span className="text-sm text-text-secondary">Show PDF view</span>
          <button
            type="button"
            role="switch"
            aria-checked={showPdf}
            onClick={() => setShowPdf((v) => !v)}
            className={clsx(
              'relative h-6 w-11 rounded-full transition-colors',
              showPdf ? 'bg-primary-600' : 'bg-gray-300'
            )}
          >
            <span
              className={clsx(
                'absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform',
                showPdf && 'translate-x-5'
              )}
            />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="min-h-0 flex-1 overflow-y-auto bg-gray-100 p-4">
        {showPdf ? (
          previewError && !html ? (
            <div className="mx-auto max-w-lg rounded-lg border border-amber-200 bg-amber-50 p-8 text-center text-sm text-amber-900">
              <FileText className="mx-auto mb-3 h-10 w-10 text-amber-600" />
              <p className="font-medium">Print preview unavailable</p>
              <p className="mt-1 text-amber-800/90">{previewError}</p>
            </div>
          ) : (
            <div
              className="mx-auto w-full max-w-[210mm] bg-white p-8 shadow-lg print:shadow-none"
              dangerouslySetInnerHTML={{ __html: html }}
            />
          )
        ) : (
          <PurchaseOrderSummaryView order={order} items={items} />
        )}
      </div>

      <SlideOverPanel
        open={attachmentsOpen}
        onClose={() => setAttachmentsOpen(false)}
        title="Attachments"
        widthClass="max-w-lg"
      >
        {business?.id && (
          <PurchaseOrderAttachmentsPanel
            orderId={orderId}
            businessId={business.id}
            onActivity={() => setHistoryRefreshKey((k) => k + 1)}
          />
        )}
      </SlideOverPanel>

      <SlideOverPanel
        open={commentsOpen}
        onClose={() => setCommentsOpen(false)}
        title="Comments & history"
        widthClass="max-w-md"
      >
        <PurchaseOrderCommentsHistoryPanel
          orderId={orderId}
          refreshKey={historyRefreshKey}
        />
      </SlideOverPanel>

      <SendDocumentEmailModal
        open={emailModalOpen}
        onClose={() => setEmailModalOpen(false)}
        onSent={() => setHistoryRefreshKey((k) => k + 1)}
        documentTable="purchase_orders"
        documentId={orderId}
        partyName={order.party_name || order.supplier_name || 'Vendor'}
        partyEmail={order.party_email || order.supplier_email}
        documentNumber={order.order_number}
        documentDate={order.order_date}
        amount={order.grand_total}
        businessName={business?.name || 'Your business'}
        fromEmail={business?.email || user?.email || ''}
        fromName={business?.name}
      />
    </div>
  );
}
