'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowLeft,
  Download,
  Loader2,
  Printer,
  Share2,
  Pencil,
  MessageCircle,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/Button';
import { ShareInvoiceModal } from '@/components/modals/ShareInvoiceModal';

type InvoiceSummary = {
  id: string;
  invoice_number?: string;
  grand_total?: number;
  paid_amount?: number;
  balance_amount?: number;
  customer_name?: string;
  customer_phone?: string;
  document_type?: string;
};

export default function PublicInvoiceViewPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const invoiceId = params.id as string;
  const { user } = useAuth();
  const fromGenerate = searchParams.get('from') === 'generate';
  const [loading, setLoading] = useState(true);
  const [html, setHtml] = useState('');
  const [invoice, setInvoice] = useState<InvoiceSummary | null>(null);
  const [shareOpen, setShareOpen] = useState(false);

  const load = useCallback(async () => {
    if (!invoiceId) return;
    setLoading(true);
    try {
      const [previewRes, invRes] = await Promise.all([
        fetch(`/api/invoices/${invoiceId}/preview?user_id=${user?.id}`),
        fetch(`/api/invoices/${invoiceId}?user_id=${user?.id}`),
      ]);
      if (previewRes.ok) {
        const data = await previewRes.json();
        setHtml(data.html || '');
      }
      if (invRes.ok) {
        const data = await invRes.json();
        const inv = data.invoice || data;
        setInvoice({
          id: inv.id,
          invoice_number: inv.invoice_number,
          grand_total: Number(inv.grand_total ?? 0),
          paid_amount: Number(inv.paid_amount ?? 0),
          balance_amount:
            inv.balance_amount != null
              ? Number(inv.balance_amount)
              : Number(inv.grand_total ?? 0) - Number(inv.paid_amount ?? 0),
          customer_name: inv.customer_name,
          customer_phone: inv.customer_phone,
          document_type: inv.document_type,
        });
      }
    } catch (error) {
      console.error('Error fetching invoice:', error);
    } finally {
      setLoading(false);
    }
  }, [invoiceId, user?.id]);

  useEffect(() => {
    load();
  }, [load]);

  const handleDownload = () => {
    window.open(`/api/invoices/${invoiceId}/pdf?user_id=${user?.id}`, '_blank');
  };

  const handlePrint = () => {
    window.open(`/api/invoices/${invoiceId}/pdf?user_id=${user?.id}`, '_blank');
  };

  const paymentLabel = (() => {
    if (!invoice) return '';
    const bal = invoice.balance_amount ?? 0;
    const paid = invoice.paid_amount ?? 0;
    if (bal <= 0.01 && paid > 0) return 'Paid';
    if (paid > 0 && bal > 0.01) return 'Partial';
    return 'Unpaid';
  })();

  const editHref = `/invoices/new?edit=${invoiceId}&type=${encodeURIComponent(invoice?.document_type || 'tax_invoice')}`;

  const grand = invoice?.grand_total ?? 0;

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Mobile post-generate chrome */}
      <div className="lg:hidden sticky top-0 z-20 bg-white border-b border-gray-200 px-2 py-2 flex items-center gap-2 safe-area-pt">
        <button
          type="button"
          onClick={() => router.push('/invoices')}
          className="p-2 rounded-full hover:bg-gray-100"
          aria-label="Back"
        >
          <ArrowLeft className="w-5 h-5 text-primary-600" />
        </button>
        <h1 className="flex-1 text-sm font-semibold text-gray-900 truncate">
          {fromGenerate ? 'Invoice created' : 'Invoice'}
        </h1>
        <Button
          variant="secondary"
          size="sm"
          className="shrink-0 text-xs"
          onClick={() => router.push(editHref)}
        >
          <Pencil className="w-3.5 h-3.5 mr-1" />
          Edit
        </Button>
      </div>

      <div className="max-w-4xl mx-auto px-3 py-4 lg:px-4 lg:py-8">
        {/* Desktop toolbar */}
        <div className="hidden lg:flex mb-4 justify-end gap-2">
          <Button variant="secondary" onClick={handleDownload}>
            <Download className="w-4 h-4 mr-2" />
            Download PDF
          </Button>
        </div>

        {/* Summary — mobile */}
        {invoice && (
          <div className="lg:hidden mb-3 rounded-xl bg-white border border-gray-200 p-4 shadow-sm">
            <div className="text-sm text-gray-600 truncate">
              {invoice.customer_name || 'Customer'}
              {invoice.customer_phone ? (
                <span className="block text-xs text-gray-500 mt-0.5">{invoice.customer_phone}</span>
              ) : null}
            </div>
            <div className="flex items-end justify-between mt-3 gap-2">
              <div>
                <div className="text-2xl font-bold text-gray-900">₹{grand.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</div>
                <span
                  className={`inline-block mt-1 text-xs font-semibold px-2 py-0.5 rounded ${
                    paymentLabel === 'Paid'
                      ? 'bg-green-100 text-green-800'
                      : paymentLabel === 'Partial'
                        ? 'bg-amber-100 text-amber-800'
                        : 'bg-orange-100 text-orange-800'
                  }`}
                >
                  {paymentLabel}
                </span>
              </div>
              {invoice.customer_phone && (
                <a
                  href={`https://wa.me/?text=${encodeURIComponent(`Invoice ${invoice.invoice_number || ''} — ₹${grand.toFixed(2)}. View: ${typeof window !== 'undefined' ? window.location.origin : ''}/invoices/${invoiceId}/view`)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-sm font-medium text-emerald-700 bg-emerald-50 px-3 py-2 rounded-lg border border-emerald-200"
                >
                  <MessageCircle className="w-4 h-4" />
                  WhatsApp
                </a>
              )}
            </div>
          </div>
        )}

        <div className="bg-white shadow-lg rounded-lg overflow-hidden border border-gray-200">
          <iframe srcDoc={html} className="w-full min-h-[70vh] lg:h-[842px] border-0" title="Invoice Preview" />
        </div>
      </div>

      {/* Mobile bottom dock */}
      <div className="lg:hidden fixed bottom-0 left-0 right-0 z-30 bg-white border-t border-gray-200 px-3 py-2 pb-[max(12px,env(safe-area-inset-bottom))] flex items-center gap-2 shadow-[0_-4px_12px_rgba(0,0,0,0.08)]">
        <button
          type="button"
          onClick={handlePrint}
          className="flex flex-col items-center justify-center flex-1 py-1 text-gray-700"
        >
          <Printer className="w-5 h-5 mb-0.5" />
          <span className="text-[10px]">Print</span>
        </button>
        <button
          type="button"
          onClick={handleDownload}
          className="flex flex-col items-center justify-center flex-1 py-1 text-gray-700"
        >
          <Download className="w-5 h-5 mb-0.5" />
          <span className="text-[10px]">Download</span>
        </button>
        <button
          type="button"
          onClick={() => setShareOpen(true)}
          className="flex flex-col items-center justify-center flex-1 py-1 text-gray-700"
        >
          <Share2 className="w-5 h-5 mb-0.5" />
          <span className="text-[10px]">Share</span>
        </button>
        <Button variant="primary" className="flex-[1.4] h-11 font-semibold" onClick={() => router.push('/invoices')}>
          Done
        </Button>
      </div>
      <div className="lg:hidden h-24" />

      {shareOpen && invoiceId && (
        <ShareInvoiceModal
          invoiceId={invoiceId}
          invoiceNumber={invoice?.invoice_number || 'N/A'}
          customerPhone={invoice?.customer_phone}
          onClose={() => setShareOpen(false)}
        />
      )}
    </div>
  );
}
