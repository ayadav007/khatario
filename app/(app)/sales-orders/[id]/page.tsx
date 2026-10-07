'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Download,
  FileText,
  Loader2,
  Mail,
  Pencil,
  Printer,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useToastContext } from '@/contexts/ToastContext';
import { Button } from '@/components/ui/Button';
import { SalesOrderPaymentSection } from '@/components/documents/SalesOrderPaymentSection';
import { SalesOrderPaymentTransactionsPanel } from '@/components/documents/SalesOrderPaymentTransactionsPanel';
import { SendDocumentEmailModal } from '@/components/email/SendDocumentEmailModal';
import { ConvertSalesOrderModal } from '@/components/sales-orders/ConvertSalesOrderModal';
import { isSalesOrderConvertibleStatus } from '@/lib/sales-orders/billing-status';
import { isSalesOrderEditable } from '@/lib/sales-orders/editability';

type SalesOrderSummary = {
  id: string;
  order_number?: string;
  order_date?: string;
  status?: string;
  grand_total?: number;
  payment_status?: string | null;
  customer_name?: string;
  customer_phone?: string;
  customer_email?: string | null;
  converted_invoice_id?: string | null;
  editable?: boolean;
};

const PREVIEW_PAGE_W = 794;
const PREVIEW_PAGE_H = 1123;
const PREVIEW_CARD_W = 280;
const PREVIEW_SCALE = PREVIEW_CARD_W / PREVIEW_PAGE_W;
const PREVIEW_CARD_H = Math.round(PREVIEW_PAGE_H * PREVIEW_SCALE);

function MinifiedPreview({ html }: { html: string }) {
  if (!html) {
    return (
      <div className="flex h-[200px] items-center justify-center text-sm text-text-muted">
        Preview unavailable
      </div>
    );
  }

  return (
    <div
      className="relative mx-auto overflow-hidden rounded-lg border border-gray-200 bg-white shadow-md"
      style={{ width: PREVIEW_CARD_W, height: PREVIEW_CARD_H }}
    >
      <iframe
        srcDoc={html}
        title="Sales order preview"
        className="pointer-events-none absolute left-0 top-0 border-0"
        style={{
          width: PREVIEW_PAGE_W,
          height: PREVIEW_PAGE_H,
          transform: `scale(${PREVIEW_SCALE})`,
          transformOrigin: '0 0',
        }}
      />
    </div>
  );
}

function ActionButton({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof Printer;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-w-[72px] flex-col items-center gap-2 touch-manipulation"
    >
      <span className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-primary-200 bg-white text-primary-600 shadow-sm dark:border-primary-800 dark:bg-surface">
        <Icon className="h-6 w-6" strokeWidth={1.75} aria-hidden />
      </span>
      <span className="text-sm font-medium text-primary-700 dark:text-primary-300">{label}</span>
    </button>
  );
}

function canEditOrder(order: SalesOrderSummary | null): boolean {
  if (!order) return false;
  if (order.editable === false) return false;
  return isSalesOrderEditable(order);
}

function canConvertOrder(order: SalesOrderSummary | null): boolean {
  if (!order) return false;
  return isSalesOrderConvertibleStatus(order.status);
}

export default function SalesOrderDetailPage() {
  const params = useParams();
  const router = useRouter();
  const orderId = params.id as string;
  const { business, user } = useAuth();
  const toast = useToastContext();

  const [loading, setLoading] = useState(true);
  const [html, setHtml] = useState('');
  const [order, setOrder] = useState<SalesOrderSummary | null>(null);
  const [convertOpen, setConvertOpen] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);

  const load = useCallback(async () => {
    if (!orderId || !business?.id) return;
    setLoading(true);
    try {
      const [orderRes, previewRes] = await Promise.all([
        fetch(`/api/sales-orders/${orderId}`, { credentials: 'include' }),
        fetch(`/api/documents/sales_orders/${orderId}/preview`, { credentials: 'include' }),
      ]);

      if (orderRes.ok) {
        const data = await orderRes.json();
        const so = data.salesOrder || data;
        setOrder({
          id: so.id,
          order_number: so.order_number,
          order_date: so.order_date,
          status: so.status,
          grand_total: Number(so.grand_total ?? 0),
          payment_status: so.payment_status ?? null,
          customer_name: so.customer_name,
          customer_phone: so.customer_phone,
          customer_email: so.customer_email,
          converted_invoice_id: so.converted_invoice_id,
          editable: so.editable,
        });
      } else {
        const data = await orderRes.json().catch(() => ({}));
        toast.error(data.error || 'Sales order not found');
        setOrder(null);
      }

      if (previewRes.ok) {
        const data = await previewRes.json();
        setHtml(data.html || '');
      } else {
        setHtml('');
      }
    } catch (error) {
      console.error('Error loading sales order:', error);
      toast.error('Failed to load sales order');
    } finally {
      setLoading(false);
    }
  }, [orderId, business?.id, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const pdfUrl = `/api/documents/sales_orders/${orderId}/pdf`;
  const editHref = `/sales-orders/new?edit=${orderId}`;
  const editable = canEditOrder(order);
  const convertible = canConvertOrder(order);
  const grand = order?.grand_total ?? 0;
  const statusLabel = order?.status
    ? order.status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
    : '';

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary-600" />
      </div>
    );
  }

  if (!order) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center">
        <p className="text-lg font-semibold text-text-primary">Sales order not found</p>
        <Button className="mt-4" variant="secondary" onClick={() => router.push('/sales-orders')}>
          Back to sales orders
        </Button>
      </div>
    );
  }

  return (
    <div className="min-h-[70vh] bg-gray-100 dark:bg-slate-950" data-testid="sales-order-view">
      {/* Mobile */}
      <div className="flex min-h-[70vh] flex-col pb-[calc(4.5rem+env(safe-area-inset-bottom,0px))] lg:hidden">
        <header className="sticky top-0 z-20 border-b border-border bg-surface px-3 py-3 pt-[max(0.75rem,env(safe-area-inset-top,0px))]">
          <div className="flex items-start gap-2">
            <button
              type="button"
              onClick={() => router.push('/sales-orders')}
              className="mt-0.5 rounded-full p-2 hover:bg-slate-100 dark:hover:bg-slate-800"
              aria-label="Back to sales orders"
            >
              <ArrowLeft className="h-5 w-5 text-primary-600" />
            </button>
            <div className="min-w-0 flex-1">
              <h1 className="text-lg font-bold leading-tight text-text-primary">Sales Order</h1>
              {order.order_number ? (
                <p className="mt-0.5 text-sm text-text-secondary">#{order.order_number}</p>
              ) : null}
            </div>
            {editable && (
              <button
                type="button"
                onClick={() => router.push(editHref)}
                className="shrink-0 rounded-lg border border-border bg-surface p-2 text-text-secondary hover:bg-slate-50 dark:hover:bg-slate-800"
                aria-label="Edit sales order"
              >
                <Pencil className="h-5 w-5" />
              </button>
            )}
          </div>
        </header>

        <div className="flex-1 overflow-y-auto">
          <div className="flex justify-center bg-slate-200/70 px-4 py-6 dark:bg-slate-900/50">
            <MinifiedPreview html={html} />
          </div>

          <div className="mx-4 -mt-2 rounded-xl border border-border bg-surface p-4 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-text-muted">Customer</p>
            <p className="mt-1 truncate font-semibold text-text-primary">
              {order.customer_name || 'Customer'}
            </p>
            {order.customer_phone ? (
              <p className="mt-0.5 text-sm text-text-secondary">{order.customer_phone}</p>
            ) : null}
            <div className="mt-3 flex items-end justify-between gap-3 border-t border-border pt-3">
              <div>
                <p className="text-2xl font-bold tabular-nums text-gray-900 dark:text-slate-50">
                  ₹{grand.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </p>
                <span className="mt-1 inline-block rounded bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                  {statusLabel}
                </span>
              </div>
            </div>
          </div>

          <div className="space-y-4 px-4 pt-4">
            <SalesOrderPaymentSection orderId={orderId} />
            <SalesOrderPaymentTransactionsPanel orderId={orderId} />
          </div>

          <div className="flex items-center justify-center gap-6 px-6 pb-2 pt-8 sm:gap-10">
            <ActionButton icon={Printer} label="Print" onClick={() => window.open(pdfUrl, '_blank')} />
            <ActionButton icon={Download} label="PDF" onClick={() => window.open(pdfUrl, '_blank')} />
            <ActionButton icon={Mail} label="Email" onClick={() => setEmailOpen(true)} />
            {convertible && (
              <ActionButton icon={FileText} label="Invoice" onClick={() => setConvertOpen(true)} />
            )}
          </div>

          <div className="px-4 pb-6 pt-4">
            <Button
              variant="primary"
              className="h-12 w-full rounded-xl text-base font-semibold"
              onClick={() => router.push('/sales-orders')}
            >
              Done
            </Button>
          </div>
        </div>
      </div>

      {/* Desktop */}
      <div className="hidden lg:block">
        <div className="mx-auto max-w-5xl px-4 py-8">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <button
                type="button"
                onClick={() => router.push('/sales-orders')}
                className="mt-0.5 rounded-lg border border-border bg-surface p-2 text-text-secondary hover:bg-slate-50"
                aria-label="Back"
              >
                <ArrowLeft className="h-5 w-5" />
              </button>
              <div>
                <h1 className="text-xl font-bold text-text-primary">
                  Sales Order{order.order_number ? ` #${order.order_number}` : ''}
                </h1>
                <p className="text-sm text-text-secondary">
                  {[order.customer_name, statusLabel].filter(Boolean).join(' · ')}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => window.open(pdfUrl, '_blank')}>
                <Printer className="mr-2 h-4 w-4" />
                Print
              </Button>
              <Button variant="secondary" onClick={() => window.open(pdfUrl, '_blank')}>
                <Download className="mr-2 h-4 w-4" />
                PDF
              </Button>
              <Button variant="secondary" onClick={() => setEmailOpen(true)}>
                <Mail className="mr-2 h-4 w-4" />
                Email
              </Button>
              {editable && (
                <Button variant="secondary" onClick={() => router.push(editHref)}>
                  <Pencil className="mr-2 h-4 w-4" />
                  Edit
                </Button>
              )}
              {convertible && (
                <Button variant="primary" onClick={() => setConvertOpen(true)}>
                  <FileText className="mr-2 h-4 w-4" />
                  Convert to invoice
                </Button>
              )}
            </div>
          </div>

          <div className="mb-4 space-y-4">
            <SalesOrderPaymentSection orderId={orderId} />
            <SalesOrderPaymentTransactionsPanel orderId={orderId} />
          </div>

          <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg">
            {html ? (
              <iframe srcDoc={html} className="h-[842px] w-full border-0" title="Sales order preview" />
            ) : (
              <div className="flex h-64 items-center justify-center text-sm text-text-muted">
                Preview unavailable
              </div>
            )}
          </div>
        </div>
      </div>

      {emailOpen && business && (
        <SendDocumentEmailModal
          open={emailOpen}
          onClose={() => setEmailOpen(false)}
          documentTable="sales_orders"
          documentId={orderId}
          partyName={order.customer_name || 'Customer'}
          partyEmail={order.customer_email}
          documentNumber={order.order_number || 'N/A'}
          documentDate={order.order_date}
          amount={order.grand_total}
          businessName={business.name || 'Business'}
          fromEmail={user?.email || business.email || ''}
          fromName={business.name || undefined}
        />
      )}

      <ConvertSalesOrderModal
        open={convertOpen}
        orderId={orderId}
        orderNumber={order.order_number}
        onClose={() => setConvertOpen(false)}
        onSuccess={({ invoiceId, invoiceNumber, partial }) => {
          setConvertOpen(false);
          toast.success(
            partial
              ? `Partial invoice created — order still open (${invoiceNumber || 'invoice'})`
              : 'Sales order converted to invoice',
          );
          if (invoiceId && !partial) {
            router.push(`/invoices/${invoiceId}/view`);
          } else {
            void load();
          }
        }}
      />
    </div>
  );
}
