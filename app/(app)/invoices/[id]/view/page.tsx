'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, Download, Loader2, Printer, Share2, Pencil } from 'lucide-react';
import { clsx } from 'clsx';
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

/** A4-ish preview scaled to fit a phone-width card */
const PREVIEW_PAGE_W = 794;
const PREVIEW_PAGE_H = 1123;
const PREVIEW_CARD_W = 280;
const PREVIEW_SCALE = PREVIEW_CARD_W / PREVIEW_PAGE_W;
const PREVIEW_CARD_H = Math.round(PREVIEW_PAGE_H * PREVIEW_SCALE);

function MinifiedInvoicePreview({ html }: { html: string }) {
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
        title="Invoice preview"
        className="absolute left-0 top-0 border-0 pointer-events-none"
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

function PostGenerateAction({
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
      className="flex flex-col items-center gap-2 min-w-[72px] touch-manipulation"
    >
      <span className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-primary-200 bg-white text-primary-600 shadow-sm dark:border-primary-800 dark:bg-surface">
        <Icon className="h-6 w-6" strokeWidth={1.75} aria-hidden />
      </span>
      <span className="text-sm font-medium text-primary-700 dark:text-primary-300">{label}</span>
    </button>
  );
}

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

  const pdfUrl = `/api/invoices/${invoiceId}/pdf?user_id=${user?.id}`;

  const handleDownload = () => {
    window.open(pdfUrl, '_blank');
  };

  const handlePrint = () => {
    window.open(pdfUrl, '_blank');
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
      <div className="min-h-screen flex items-center justify-center bg-gray-100 dark:bg-slate-950">
        <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-slate-950">
      {/* ——— Mobile: post-generate style ——— */}
      <div className="lg:hidden min-h-screen flex flex-col pb-[calc(4.5rem+env(safe-area-inset-bottom,0px))]">
        <header className="sticky top-0 z-20 border-b border-border bg-surface px-3 py-3 pt-[max(0.75rem,env(safe-area-inset-top,0px))]">
          <div className="flex items-start gap-2">
            <button
              type="button"
              onClick={() => router.push('/invoices')}
              className="mt-0.5 rounded-full p-2 hover:bg-slate-100 dark:hover:bg-slate-800"
              aria-label="Back to invoices"
            >
              <ArrowLeft className="h-5 w-5 text-primary-600" />
            </button>
            <div className="min-w-0 flex-1">
              <h1 className="text-lg font-bold text-text-primary leading-tight">
                {fromGenerate ? 'Invoice created' : 'Invoice'}
              </h1>
              {invoice?.invoice_number ? (
                <p className="text-sm text-text-secondary mt-0.5">#{invoice.invoice_number}</p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => router.push(editHref)}
              className="shrink-0 rounded-lg border border-border bg-surface p-2 text-text-secondary hover:bg-slate-50 dark:hover:bg-slate-800"
              aria-label="Edit invoice"
            >
              <Pencil className="h-5 w-5" />
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto">
          {/* Minified document preview */}
          <div className="bg-slate-200/70 dark:bg-slate-900/50 px-4 py-6 flex justify-center">
            <MinifiedInvoicePreview html={html} />
          </div>

          {invoice ? (
            <div className="mx-4 -mt-2 rounded-xl border border-border bg-surface p-4 shadow-sm">
              <p className="text-xs font-medium uppercase tracking-wide text-text-muted">Customer</p>
              <p className="mt-1 font-semibold text-text-primary truncate">
                {invoice.customer_name || 'Walk-in customer'}
              </p>
              {invoice.customer_phone ? (
                <p className="text-sm text-text-secondary mt-0.5">{invoice.customer_phone}</p>
              ) : null}
              <div className="mt-3 flex items-end justify-between gap-3 border-t border-border pt-3">
                <div>
                  <p className="text-2xl font-bold tabular-nums text-gray-900 dark:text-slate-50">
                    ₹{grand.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </p>
                  <span
                    className={clsx(
                      'mt-1 inline-block text-xs font-semibold px-2 py-0.5 rounded',
                      paymentLabel === 'Paid'
                        ? 'bg-green-100 text-green-800 dark:bg-green-950/50 dark:text-green-300'
                        : paymentLabel === 'Partial'
                          ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300'
                          : 'bg-orange-100 text-orange-800 dark:bg-orange-950/50 dark:text-orange-300'
                    )}
                  >
                    {paymentLabel}
                  </span>
                </div>
              </div>
            </div>
          ) : null}

          {/* Print · Download · Share — below preview, always visible */}
          <div className="px-6 pt-8 pb-2 flex items-center justify-center gap-6 sm:gap-10">
            <PostGenerateAction icon={Printer} label="Print" onClick={handlePrint} />
            <PostGenerateAction icon={Download} label="Download" onClick={handleDownload} />
            <PostGenerateAction icon={Share2} label="Share" onClick={() => setShareOpen(true)} />
          </div>

          <div className="px-4 pt-4 pb-6">
            <Button
              variant="primary"
              className="w-full h-12 text-base font-semibold rounded-xl"
              onClick={() => router.push('/invoices')}
            >
              Done
            </Button>
          </div>
        </div>
      </div>

      {/* ——— Desktop ——— */}
      <div className="hidden lg:block">
        <div className="max-w-4xl mx-auto px-4 py-8">
          <div className="mb-4 flex items-center justify-between gap-4">
            <div>
              <h1 className="text-xl font-bold text-text-primary">
                {fromGenerate ? 'Invoice created' : 'Invoice'}
                {invoice?.invoice_number ? ` #${invoice.invoice_number}` : ''}
              </h1>
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={handlePrint}>
                <Printer className="w-4 h-4 mr-2" />
                Print
              </Button>
              <Button variant="secondary" onClick={handleDownload}>
                <Download className="w-4 h-4 mr-2" />
                Download PDF
              </Button>
              <Button variant="secondary" onClick={() => setShareOpen(true)}>
                <Share2 className="w-4 h-4 mr-2" />
                Share
              </Button>
              <Button variant="primary" onClick={() => router.push('/invoices')}>
                Done
              </Button>
            </div>
          </div>

          <div className="bg-white shadow-lg rounded-lg overflow-hidden border border-gray-200">
            <iframe
              srcDoc={html}
              className="w-full h-[842px] border-0"
              title="Invoice Preview"
            />
          </div>
        </div>
      </div>

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
