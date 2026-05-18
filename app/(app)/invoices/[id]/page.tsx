'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ArrowLeft, Download, Edit, Share2, CreditCard, Loader2, XCircle, Send, Ban, AlertTriangle, Bluetooth, Mail } from 'lucide-react';
import { SendDocumentEmailModal } from '@/components/email/SendDocumentEmailModal';
import { ShareInvoiceModal } from '@/components/modals/ShareInvoiceModal';
import { RecordPaymentModal } from '@/components/modals/RecordPaymentModal';
import { CancelInvoiceModal } from '@/components/modals/CancelInvoiceModal';
import { DocumentList } from '@/components/documents/DocumentList';
import { DocumentUploader } from '@/components/documents/DocumentUploader';
import { useAuth } from '@/contexts/AuthContext';
import { useToastContext } from '@/contexts/ToastContext';
import { Breadcrumbs } from '@/components/navigation/Breadcrumbs';
import { ProformaLifecycleManager } from '@/components/invoices/ProformaLifecycleManager';
import {
  InvoiceProfitSummaryCard,
  parseProfitSummary,
  type InvoiceProfitSummaryDto,
} from '@/components/invoices/InvoiceProfitSummaryCard';
import { CreditWarningBanner } from '@/components/credit/CreditWarningBanner';
import { CreditMetrics } from '@/lib/credit-utils';
import { safeJsonParse, getApiErrorMessage } from '@/lib/api-utils';
import { useBluetoothPrinter } from '@/hooks/useBluetoothPrinter';
import { invoicePayloadToReceipt } from '@/lib/bluetooth/invoice-payload-to-receipt';
import { useFeatureRegistry } from '@/hooks/useFeatureRegistry';

export default function InvoiceDetailPage() {
  const params = useParams();
  const router = useRouter();
  const invoiceId = params.id as string;
  const { user, business } = useAuth();
  const toast = useToastContext();
  const bt = useBluetoothPrinter();
  const { hasFeature } = useFeatureRegistry();
  const canBtPrint = hasFeature('barcode_thermal_printer');
  const [btPrinting, setBtPrinting] = useState(false);

  const [invoice, setInvoice] = useState<any>(null);
  const [payments, setPayments] = useState<any[]>([]);
  const [html, setHtml] = useState('');
  const [loading, setLoading] = useState(true);
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [emailModalOpen, setEmailModalOpen] = useState(false);
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const [showDocumentUploader, setShowDocumentUploader] = useState(false);
  const [converting, setConverting] = useState(false);
  const [showConvertModal, setShowConvertModal] = useState(false);
  const [convertStatus, setConvertStatus] = useState<'draft' | 'final' | null>(null);
  const [creditMetrics, setCreditMetrics] = useState<{ current?: CreditMetrics; projected?: CreditMetrics } | null>(null);
  const [creditApproval, setCreditApproval] = useState<any>(null);
  const [profitSummary, setProfitSummary] = useState<InvoiceProfitSummaryDto | null>(null);
  const [requestingApproval, setRequestingApproval] = useState(false);

  useEffect(() => {
    if (invoiceId && business?.id) {
      fetchInvoice();
      fetchPayments();
      fetchCreditApproval();
    }
  }, [invoiceId, business?.id]);

  async function fetchInvoice() {
    try {
      const resInv = await fetch(`/api/invoices/${invoiceId}?user_id=${user?.id}`);
      const dataInv = await resInv.json();
      if (!resInv.ok) {
        setProfitSummary(null);
        setInvoice(null);
        setCreditMetrics(null);
        return;
      }
      // Handle both { invoice: {...} } and direct invoice object
      const invoiceData = dataInv.invoice || dataInv;
      console.log('Invoice data:', {
        document_type: invoiceData.document_type,
        invoice_number: invoiceData.invoice_number,
        is_proforma: invoiceData.document_type === 'proforma_invoice'
      });
      setInvoice(invoiceData);
      setProfitSummary(parseProfitSummary(dataInv.profit_summary));

      // PHASE 6: Extract credit metrics from API response
      if (dataInv.credit_metrics) {
        setCreditMetrics(dataInv.credit_metrics);
      }

      const resPreview = await fetch(`/api/invoices/${invoiceId}/preview`);
      const dataPreview = await resPreview.json();
      if (resPreview.ok && dataPreview.html) {
        setHtml(dataPreview.html);
      } else {
        console.error('Preview error:', dataPreview.error || 'Unknown error');
        setHtml(`<div style="padding: 20px; color: red;"><h3>Preview Error</h3><p>${dataPreview.error || 'Failed to generate preview'}</p></div>`);
      }
    } catch (error) {
      console.error('Error fetching invoice:', error);
      setProfitSummary(null);
    } finally {
      setLoading(false);
    }
  }

  async function fetchPayments() {
    if (!business?.id) return; // Don't fetch if business not loaded
    try {
      const res = await fetch(`/api/payments?business_id=${business.id}&reference_type=invoice&reference_id=${invoiceId}&user_id=${user?.id}`);
      if (res.ok) {
        const data = await res.json();
        setPayments(data.payments || []);
      }
    } catch (error) {
      console.error('Error fetching payments:', error);
    }
  }

  async function fetchCreditApproval() {
    if (!business?.id || !invoiceId) return;
    try {
      const res = await fetch(`/api/credit-approvals/pending?business_id=${business.id}&user_id=${user?.id}`);
      if (res.ok) {
        const data = await res.json();
        const approval = data.approvals?.find((a: any) => 
          a.reference_type === 'invoice' && a.reference_id === invoiceId
        );
        setCreditApproval(approval || null);
      }
    } catch (error) {
      console.error('Error fetching credit approval:', error);
    }
  }

  async function handleRequestApproval() {
    if (!invoice?.customer_id || !business?.id || !user?.id) return;
    
    const reason = prompt('Please provide a reason for this credit approval request:');
    if (!reason) return;

    setRequestingApproval(true);
    try {
      const res = await fetch('/api/credit-approvals/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: business.id,
          entity_type: 'customer',
          entity_id: invoice.customer_id,
          reference_type: 'invoice',
          reference_id: invoiceId,
          requested_by: user.id,
          reason,
        }),
      });

      if (res.ok) {
        toast.success('Credit approval requested successfully!');
        await fetchCreditApproval();
      } else {
        const data = await safeJsonParse(res);
        toast.error(getApiErrorMessage(data, 'Failed to request approval'));
      }
    } catch (error) {
      console.error('Error requesting approval:', error);
      toast.error('Failed to request approval');
    } finally {
      setRequestingApproval(false);
    }
  }

  const handlePaymentSuccess = () => {
    fetchInvoice();
    fetchPayments();
  };

  const handleCancelSuccess = () => {
    fetchInvoice();
    router.push('/invoices');
  };

  const handleConvertToTaxInvoice = () => {
    setShowConvertModal(true);
  };

  const handleConvertConfirm = async () => {
    if (!convertStatus) {
      toast.warning('Please select whether to create as Draft or Final');
      return;
    }
    
    setShowConvertModal(false);
    setConverting(true);
    try {
      const res = await fetch(`/api/invoices/${invoiceId}/convert-to-tax-invoice`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: convertStatus })
      });
      
      if (res.ok) {
        const data = await res.json();
        toast.success(`Proforma invoice converted successfully! New tax invoice: ${data.invoice_number} (${convertStatus})`);
        router.push(`/invoices/${data.invoice_id}`);
      } else {
        const error = await safeJsonParse(res);
        toast.error(getApiErrorMessage(error, 'Failed to convert proforma invoice'));
      }
    } catch (error) {
      console.error('Error converting proforma:', error);
      toast.error('Failed to convert proforma invoice');
    } finally {
      setConverting(false);
      setConvertStatus(null);
    }
  };

  const handlePrintBluetooth = async () => {
    if (!invoice) return;
    if (!bt.supported) {
      toast.error(
        'Bluetooth printing is not supported in this browser. Use Chrome on Android or desktop Chrome/Edge.'
      );
      return;
    }
    if (bt.savedPrinters.length === 0) {
      toast.error(
        'No Bluetooth printer paired. Go to Settings → Bluetooth Printer to pair one.'
      );
      return;
    }
    setBtPrinting(true);
    try {
      const receipt = invoicePayloadToReceipt(invoice, (business as any) || {});
      await bt.printReceipt(receipt);
      toast.success('Receipt sent to Bluetooth printer');
    } catch (err: any) {
      toast.error(err?.message || 'Bluetooth print failed');
    } finally {
      setBtPrinting(false);
    }
  };

  const handleFinalize = async () => {
    if (!confirm('Finalize this invoice? This will deduct stock, lock the invoice, and affect GST filing.')) return;
    try {
      const res = await fetch(`/api/invoices/${invoiceId}/finalize`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: user?.id }),
      });
      if (res.ok) {
        await fetchInvoice();
        await fetchCreditApproval();
        toast.success('Invoice finalized successfully!');
      } else {
        const data = await safeJsonParse(res);
        if (data?.code === 'CREDIT_LIMIT_EXCEEDED' && data?.requires_approval) {
          toast.warning('Credit limit exceeded. Please request approval first.');
        } else {
          toast.error(getApiErrorMessage(data, 'Failed to finalize invoice'));
        }
      }
    } catch (error) {
      console.error('Error finalizing invoice:', error);
      toast.error('Failed to finalize invoice');
    }
  };

  if (loading) {
    return (
      
        <div className="flex items-center justify-center h-[60vh]">
          <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
        </div>
      
    );
  }

  if (!invoice) {
    return (
      
        <div className="text-center py-12">
          <p className="text-text-muted">Invoice not found</p>
          <Button variant="ghost" onClick={() => router.push('/invoices')} className="mt-4">
            Back to Invoices
          </Button>
        </div>
      
    );
  }

  const status = invoice.status || 'draft';
  const paymentStatus = invoice.payment_status || 'unpaid';
  const isDraft = status === 'draft';
  const isFinal = status === 'final';
  const isCancelled = status === 'cancelled';
  const isProforma = invoice.document_type === 'proforma_invoice';

  const bluetoothPrintButton = canBtPrint ? (
    <Button
      variant="secondary"
      onClick={handlePrintBluetooth}
      disabled={btPrinting || !bt.supported || bt.savedPrinters.length === 0}
      title={
        !bt.supported
          ? 'Bluetooth not supported in this browser'
          : bt.savedPrinters.length === 0
            ? 'Pair a printer in Settings → Bluetooth Printer'
            : 'Print receipt to Bluetooth printer'
      }
    >
      {btPrinting ? (
        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
      ) : (
        <Bluetooth className="w-4 h-4 mr-2" />
      )}
      {btPrinting ? 'Printing…' : 'Print to Bluetooth'}
    </Button>
  ) : null;
  
  // Debug log to verify document_type
  if (process.env.NODE_ENV === 'development') {
    console.log('Invoice detail - document_type:', invoice.document_type, 'isProforma:', isProforma);
  }

  // Get status badge styling
  const getStatusBadge = () => {
    if (isCancelled) {
      return 'bg-red-100 text-red-700 border-red-200 dark:bg-red-950/45 dark:text-red-300 dark:border-red-800';
    }
    if (isDraft) {
      return 'bg-gray-100 text-gray-700 border-gray-200 dark:bg-slate-700 dark:text-slate-100 dark:border-slate-600';
    }
    return 'bg-slate-100 text-primary-700 border-primary-200 dark:bg-slate-800/40 dark:text-primary-300 dark:border-primary-800';
  };

  // Get payment status badge styling
  const getPaymentBadge = () => {
    if (paymentStatus === 'paid') {
      return 'bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-300';
    }
    if (paymentStatus === 'partially_paid') {
      return 'bg-yellow-100 text-yellow-700 dark:bg-yellow-950/35 dark:text-yellow-300';
    }
    return 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300';
  };

  return (
    <>
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Breadcrumbs */}
        <Breadcrumbs customLabels={{ [`/invoices/${invoiceId}`]: invoice?.invoice_number || 'Invoice Details' }} />
        
        {/* Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => router.push('/invoices')}>
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-bold text-text-primary">
                  Invoice {invoice.invoice_number}
                </h1>
                <span className={`px-2.5 py-1 rounded-full text-xs font-medium border ${getStatusBadge()}`}>
                  {status.toUpperCase()}
                </span>
                {isCancelled && (
                  <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-red-100 text-red-700 border border-red-200 dark:bg-red-950/45 dark:text-red-300 dark:border-red-800 flex items-center gap-1">
                    <XCircle className="w-3 h-3" />
                    CANCELLED
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 text-sm text-text-secondary mt-1 flex-wrap">
                <span>{invoice.customer?.name || 'Cash Sale'}</span>
                <span>•</span>
                <span>{invoice.invoice_date ? new Date(invoice.invoice_date).toLocaleDateString() : 'No Date'}</span>
                <span>•</span>
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize ${getPaymentBadge()}`}>
                  {paymentStatus?.replace('_', ' ')}
                </span>
              </div>
            </div>
          </div>

          {/* Action Buttons - Conditional based on status */}
          <div className="flex flex-wrap gap-2">
            {isDraft && (
              <>
                <Button variant="secondary" onClick={() => router.push(`/invoices/${invoiceId}/edit`)}>
                  <Edit className="w-4 h-4 mr-2" />
                  Edit Invoice
                </Button>
                {/* PHASE 6: Conditional Finalize CTA based on credit status */}
                {creditMetrics?.projected && creditMetrics.projected.credit_status === 'OVER_LIMIT' && !creditApproval ? (
                  <Button variant="primary" onClick={handleRequestApproval} disabled={requestingApproval}>
                    {requestingApproval ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Requesting...
                      </>
                    ) : (
                      <>
                        <AlertTriangle className="w-4 h-4 mr-2" />
                        Request Approval
                      </>
                    )}
                  </Button>
                ) : creditApproval?.status === 'approved' ? (
                  <Button variant="primary" onClick={handleFinalize}>
                    <Send className="w-4 h-4 mr-2" />
                    Finalize (Approved)
                  </Button>
                ) : (
                  <Button variant="primary" onClick={handleFinalize}>
                    <Send className="w-4 h-4 mr-2" />
                    Finalize Invoice
                  </Button>
                )}
                {/* Allow payment on draft too */}
                <Button variant="secondary" onClick={() => setPaymentModalOpen(true)}>
                    <CreditCard className="w-4 h-4 mr-2" />
                    Record Payment
                </Button>
                {bluetoothPrintButton}
              </>
            )}

            {isFinal && (
              <>
                {paymentStatus !== 'paid' && (
                  <Button variant="primary" onClick={() => setPaymentModalOpen(true)}>
                    <CreditCard className="w-4 h-4 mr-2" />
                    Record Payment
                  </Button>
                )}
                <Button variant="secondary" onClick={() => setEmailModalOpen(true)}>
                  <Mail className="w-4 h-4 mr-2" />
                  Send Email
                </Button>
                <Button variant="secondary" onClick={() => setShareModalOpen(true)}>
                  <Share2 className="w-4 h-4 mr-2" />
                  Share
                </Button>
                <Button variant="secondary" onClick={() => window.open(`/api/invoices/${invoiceId}/pdf?user_id=${user?.id}`, '_blank')}>
                  <Download className="w-4 h-4 mr-2" />
                  PDF
                </Button>
                {bluetoothPrintButton}
                <Button variant="secondary" onClick={() => setCancelModalOpen(true)} className="text-red-600 hover:text-red-700 hover:border-red-300">
                  <Ban className="w-4 h-4 mr-2" />
                  Cancel Invoice
                </Button>
              </>
            )}

            {/* Convert Proforma to Tax Invoice - Allow conversion from draft or final */}
            {isProforma && (
              <Button 
                variant="primary" 
                onClick={handleConvertToTaxInvoice}
                disabled={converting}
              >
                {converting ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Converting...
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4 mr-2" />
                    Convert to Tax Invoice
                  </>
                )}
              </Button>
            )}

            {isCancelled && (
              <>
                <Button variant="secondary" onClick={() => window.open(`/api/invoices/${invoiceId}/pdf?user_id=${user?.id}`, '_blank')} disabled>
                  <Download className="w-4 h-4 mr-2" />
                  PDF (Cancelled)
                </Button>
              </>
            )}
          </div>
        </div>

        {/* PHASE 6: Credit Warning Banner */}
        {isDraft && invoice.customer_id && creditMetrics && (
          <CreditWarningBanner
            metrics={creditMetrics.current!}
            projectedMetrics={creditMetrics.projected}
            partyType="customer"
            partyName={invoice.customer?.name}
          />
        )}

        {/* Cancellation Notice */}
        {isCancelled && invoice.cancellation_details && (
          <Card padding="md" className="bg-red-50 border-red-200 dark:bg-red-950/30 dark:border-red-900">
            <div className="flex items-start gap-3">
              <XCircle className="w-5 h-5 text-red-600 dark:text-red-400 mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <h3 className="font-semibold text-red-900 dark:text-red-200 mb-1">Invoice Cancelled</h3>
                <p className="text-sm text-red-800 dark:text-red-200/90 mb-2">
                  <strong>Reason:</strong> {invoice.cancellation_details.reason || 'No reason provided'}
                </p>
                {invoice.cancellation_details.cancelled_at && (
                  <p className="text-xs text-red-700 dark:text-red-300">
                    Cancelled on: {new Date(invoice.cancellation_details.cancelled_at).toLocaleString()}
                  </p>
                )}
              </div>
            </div>
          </Card>
        )}

        {/* Proforma Invoice Lifecycle Management */}
        {isProforma && (
          <ProformaLifecycleManager
            invoiceId={invoiceId}
            currentStatus={invoice.proforma_lifecycle_status}
            currentNotes={invoice.proforma_lifecycle_notes}
          />
        )}

        {/* Payment Information - Show for non-cancelled invoices (Draft or Final) */}
        {!isCancelled && (
          <Card padding="md">
            <h3 className="font-semibold text-text-primary mb-4">Payment Information {isDraft && '(Draft)'}</h3>
            <div className="grid grid-cols-3 gap-4 mb-4">
              <div>
                <p className="text-sm text-text-secondary">Grand Total</p>
                <p className="text-lg font-semibold text-text-primary">₹{Number(invoice.grand_total || 0).toLocaleString('en-IN')}</p>
              </div>
              <div>
                <p className="text-sm text-text-secondary">Paid Amount</p>
                <p className="text-lg font-semibold text-green-600 dark:text-green-400">₹{Number(invoice.paid_amount || 0).toLocaleString('en-IN')}</p>
              </div>
              <div>
                <p className="text-sm text-text-secondary">Balance</p>
                <p className="text-lg font-semibold text-red-600 dark:text-red-400">₹{Number(invoice.balance_amount || invoice.grand_total || 0).toLocaleString('en-IN')}</p>
              </div>
            </div>

            {/* Payment History */}
            {payments.length > 0 && (
              <div className="mt-4 pt-4 border-t border-border">
                <h4 className="font-medium text-text-primary mb-2">Payment History</h4>
                <div className="space-y-2">
                  {payments.map((payment) => (
                    <div
                      key={payment.id}
                      className="flex justify-between items-center gap-2 text-sm rounded-md border border-border bg-slate-100/90 p-2.5 dark:bg-slate-800/70"
                    >
                      <div className="min-w-0">
                        <span className="font-medium text-text-primary">
                          ₹{Number(payment.amount).toLocaleString('en-IN')}
                        </span>
                        <span className="text-text-secondary ml-2">via {payment.payment_mode || 'N/A'}</span>
                        {payment.notes && (
                          <span className="text-text-muted ml-2">({payment.notes})</span>
                        )}
                      </div>
                      <span className="shrink-0 text-text-secondary">
                        {new Date(payment.payment_date).toLocaleDateString()}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Card>
        )}

        {profitSummary && (
          <InvoiceProfitSummaryCard summary={profitSummary} />
        )}

        {/* Preview */}
        <Card padding="none" className="overflow-hidden border border-border shadow-sm">
          <div className="bg-background/80 p-4 border-b border-border flex justify-between items-center dark:bg-slate-900/40">
            <span className="text-sm font-medium text-text-secondary">Live Preview</span>
          </div>
          <div className="flex justify-center bg-slate-100 p-8 dark:bg-slate-950/80">
            {html ? (
              <iframe
                srcDoc={html}
                className="w-full max-w-[210mm] h-[297mm] shadow-lg bg-white"
                style={{ border: 'none' }}
                title="Invoice Preview"
              />
            ) : (
              <div className="flex items-center justify-center h-[297mm] text-text-muted">
                {loading ? (
                  <div className="text-center">
                    <Loader2 className="w-8 h-8 animate-spin mx-auto mb-2" />
                    <p>Loading preview...</p>
                  </div>
                ) : (
                  <div className="text-center">
                    <p className="text-red-600">Failed to load preview</p>
                    <p className="text-sm mt-2">Check console for details</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </Card>
      </div>

      {/* Modals */}
      {shareModalOpen && (
        <ShareInvoiceModal
          invoiceId={invoice.id}
          invoiceNumber={invoice.invoice_number}
          customerEmail={invoice.customer?.email}
          customerPhone={invoice.customer?.phone}
          onClose={() => setShareModalOpen(false)}
        />
      )}

      {emailModalOpen && invoice && (
        <SendDocumentEmailModal
          open={emailModalOpen}
          onClose={() => setEmailModalOpen(false)}
          documentTable="invoices"
          documentId={invoice.id}
          partyName={invoice.customer?.name || invoice.customer_name || 'Customer'}
          partyEmail={invoice.customer?.email || invoice.customer_email}
          documentNumber={invoice.invoice_number}
          documentDate={invoice.invoice_date}
          amount={invoice.grand_total}
          businessName={business?.name || 'Your business'}
          fromEmail={business?.email || user?.email || ''}
          fromName={business?.name}
        />
      )}

      {paymentModalOpen && invoice && (
        <RecordPaymentModal
          invoiceId={invoice.id}
          invoiceNumber={invoice.invoice_number}
          grandTotal={Number(invoice.grand_total || 0)}
          paidAmount={Number(invoice.paid_amount || 0)}
          balanceAmount={Number(invoice.balance_amount || invoice.grand_total || 0)}
          onSuccess={handlePaymentSuccess}
          onClose={() => setPaymentModalOpen(false)}
        />
      )}

      {cancelModalOpen && invoice && (
        <CancelInvoiceModal
          invoiceId={invoice.id}
          invoiceNumber={invoice.invoice_number}
          onSuccess={handleCancelSuccess}
          onClose={() => setCancelModalOpen(false)}
          cancelledBy={user?.id}
        />
      )}

      {/* Convert Proforma to Tax Invoice Modal */}
      {showConvertModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-surface border border-transparent dark:border-border rounded-xl shadow-xl max-w-md w-full p-6">
            <h3 className="text-lg font-semibold text-text-primary mb-4">
              Convert Proforma Invoice to Tax Invoice
            </h3>
            <p className="text-sm text-text-secondary mb-6">
              Choose how you want to create the new tax invoice:
            </p>
            
            <div className="space-y-3 mb-6">
              <label className="flex items-center p-4 border-2 border-border rounded-lg cursor-pointer hover:bg-slate-100/80 dark:hover:bg-slate-800 transition-colors">
                <input
                  type="radio"
                  name="convertStatus"
                  value="draft"
                  checked={convertStatus === 'draft'}
                  onChange={(e) => setConvertStatus(e.target.value as 'draft')}
                  className="mr-3 w-4 h-4 text-primary-600"
                />
                <div>
                  <div className="font-medium text-text-primary">Draft (Editable)</div>
                  <div className="text-sm text-text-muted">Create as draft so you can review and edit before finalizing</div>
                </div>
              </label>
              
              <label className="flex items-center p-4 border-2 border-border rounded-lg cursor-pointer hover:bg-slate-100/80 dark:hover:bg-slate-800 transition-colors">
                <input
                  type="radio"
                  name="convertStatus"
                  value="final"
                  checked={convertStatus === 'final'}
                  onChange={(e) => setConvertStatus(e.target.value as 'final')}
                  className="mr-3 w-4 h-4 text-primary-600"
                />
                <div>
                  <div className="font-medium text-text-primary">Final (Locked)</div>
                  <div className="text-sm text-text-muted">Create as final invoice immediately (will deduct stock and affect GST)</div>
                </div>
              </label>
            </div>

            <div className="flex gap-3">
              <Button
                variant="secondary"
                onClick={() => {
                  setShowConvertModal(false);
                  setConvertStatus(null);
                }}
                className="flex-1"
                disabled={converting}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={handleConvertConfirm}
                className="flex-1"
                disabled={converting || !convertStatus}
                isLoading={converting}
              >
                Convert
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
