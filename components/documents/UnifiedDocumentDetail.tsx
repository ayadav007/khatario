'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { AppLayout } from '@/components/layout/AppLayout';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { 
  ArrowLeft, 
  Download, 
  Edit, 
  Printer, 
  Loader2, 
  XCircle, 
  Send,
  FileText,
  Mail,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { SendDocumentEmailModal } from '@/components/email/SendDocumentEmailModal';
import { ConfigureBusinessEmailModal } from '@/components/email/ConfigureBusinessEmailModal';
import { useGatedDocumentEmail } from '@/hooks/useGatedDocumentEmail';
import type { DocumentTable } from '@/lib/pdf-generator';
import { ScaledA4Preview } from '@/components/invoices/ScaledA4Preview';
import { Breadcrumbs } from '@/components/navigation/Breadcrumbs';
import { useToastContext } from '@/contexts/ToastContext';

interface UnifiedDocumentDetailProps {
  documentId: string;
  table: string;
  title: string;
  backUrl: string;
  editUrlPrefix: string;
  pdfUrlPrefix?: string;
  /** Renders below the header toolbar (e.g. sales order payment summary). */
  topContent?: ReactNode;
  /** Hide the Edit button for documents that can no longer change. */
  canEdit?: (document: any) => boolean;
  /** Extra toolbar buttons; `reload` refetches the document and preview. */
  headerActions?: (document: any, reload: () => void) => ReactNode;
}

export const UnifiedDocumentDetail: React.FC<UnifiedDocumentDetailProps> = ({
  documentId,
  table,
  title,
  backUrl,
  editUrlPrefix,
  pdfUrlPrefix = '/api/documents',
  topContent,
  canEdit,
  headerActions,
}) => {
  const router = useRouter();
  const { business, user } = useAuth();
  const toast = useToastContext();
  
  const [documentData, setDocumentData] = useState<any>(null);
  const [html, setHtml] = useState('');
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const {
    checking: emailChecking,
    composeOpen: emailModalOpen,
    configureOpen: emailConfigureOpen,
    configureForbidden: emailConfigureForbidden,
    requestSendEmail,
    onEmailConfigured,
    closeConfigure: closeEmailConfigure,
    closeCompose: closeEmailCompose,
  } = useGatedDocumentEmail();

  const emailableTables: DocumentTable[] = [
    'invoices',
    'sales_orders',
    'delivery_challans',
    'credit_notes',
    'debit_notes',
    'purchase_orders',
    'work_orders',
  ];
  const canEmail = emailableTables.includes(table as DocumentTable);

  const docNumber: string | undefined =
    documentData?.invoice_number ||
    documentData?.order_number ||
    documentData?.challan_number ||
    documentData?.work_order_number ||
    documentData?.credit_note_number ||
    documentData?.debit_note_number;
  const docDate: string | undefined =
    documentData?.invoice_date ||
    documentData?.order_date ||
    documentData?.challan_date ||
    documentData?.work_order_date ||
    documentData?.credit_note_date ||
    documentData?.debit_note_date;

  useEffect(() => {
    if (documentId && business?.id) {
      fetchData();
    }
  }, [documentId, business?.id]);

  async function fetchData() {
    setPreviewError(null);
    try {
      const resDoc = await fetch(`/api/documents/${table}/${documentId}`);
      const dataDoc = await resDoc.json();
      if (!resDoc.ok) {
        setDocumentData(null);
        setPreviewError(dataDoc.error || 'Failed to load document');
        return;
      }
      setDocumentData(dataDoc.document);

      const resPreview = await fetch(`/api/documents/${table}/${documentId}/preview`);
      const dataPreview = await resPreview.json();
      if (!resPreview.ok) {
        setHtml('');
        setPreviewError(dataPreview.error || 'Preview could not be generated');
        toast.error(dataPreview.error || 'Preview could not be generated');
        return;
      }
      setHtml(typeof dataPreview.html === 'string' ? dataPreview.html : '');
      if (!dataPreview.html) {
        setPreviewError('Preview returned empty content');
      }
    } catch (error) {
      console.error(`Error fetching ${table}:`, error);
      setPreviewError('Failed to load document preview');
      toast.error('Failed to load document preview');
    } finally {
      setLoading(false);
    }
  }

  const handlePrint = () => {
    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(html);
      printWindow.document.close();
      printWindow.focus();
      setTimeout(() => {
        printWindow.print();
      }, 500);
    }
  };

  const handleDownloadPdf = async () => {
    try {
      setDownloading(true);
      const res = await fetch(`${pdfUrlPrefix}/${table}/${documentId}/pdf`);
      if (!res.ok) throw new Error('Failed to generate PDF');
      
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${docNumber || 'document'}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (error) {
      console.error('Error downloading PDF:', error);
      toast.error('Failed to download PDF');
    } finally {
      setDownloading(false);
    }
  };

  if (loading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center h-[60vh]">
          <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
        </div>
      </AppLayout>
    );
  }

  if (!documentData) {
    return (
      <AppLayout>
        <div className="text-center py-12">
          <FileText className="mx-auto h-12 w-12 text-gray-400" />
          <h3 className="mt-2 text-sm font-medium text-gray-900">Document not found</h3>
          <Button variant="ghost" onClick={() => router.push(backUrl)} className="mt-4">
            Back to List
          </Button>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="no-print">
          <Breadcrumbs items={[
            { label: title + 's', href: backUrl },
            { label: docNumber || 'Detail' }
          ]} />
        </div>

        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-4 rounded-xl border border-border shadow-sm no-print">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => router.push(backUrl)}>
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <div>
              <h1 className="text-xl font-bold text-gray-900">
                {title} {docNumber}
              </h1>
              <p className="text-sm text-gray-500">
                {[documentData.party_name, docDate ? new Date(docDate).toLocaleDateString() : null]
                  .filter(Boolean)
                  .join(' • ')}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={handlePrint}>
              <Printer className="w-4 h-4 mr-2" />
              Print
            </Button>
            <Button variant="secondary" size="sm" onClick={handleDownloadPdf} isLoading={downloading}>
              <Download className="w-4 h-4 mr-2" />
              PDF
            </Button>
            {(!canEdit || canEdit(documentData)) && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() =>
                  router.push(
                    editUrlPrefix.endsWith('/new')
                      ? `${editUrlPrefix}?edit=${documentId}`
                      : `${editUrlPrefix}/${documentId}`
                  )
                }
              >
                <Edit className="w-4 h-4 mr-2" />
                Edit
              </Button>
            )}
            {headerActions?.(documentData, fetchData)}
            {canEmail && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void requestSendEmail()}
                disabled={emailChecking}
                isLoading={emailChecking}
              >
                <Mail className="w-4 h-4 mr-2" />
                Send Email
              </Button>
            )}
          </div>
        </div>

        {topContent ? <div className="no-print">{topContent}</div> : null}

        <Card padding="none" className="overflow-hidden bg-gray-100 min-h-[800px] flex justify-center print:bg-white print:shadow-none print:my-0 print:p-0">
          {previewError && !html ? (
            <div className="my-8 flex w-full max-w-lg flex-col items-center justify-center gap-3 rounded-lg border border-amber-200 bg-amber-50 p-8 text-center text-sm text-amber-900">
              <FileText className="h-10 w-10 text-amber-600" />
              <p className="font-medium">Print preview unavailable</p>
              <p className="text-amber-800/90">{previewError}</p>
              <p className="text-xs text-amber-700/80">PDF may still work if generation uses a different path. Try Download PDF or check the server log.</p>
            </div>
          ) : (
            <div className="p-3 lg:p-8">
              {html ? <ScaledA4Preview html={html} title={`${title} preview`} /> : null}
            </div>
          )}
        </Card>

        {canEmail && business?.id && (
          <ConfigureBusinessEmailModal
            open={emailConfigureOpen}
            businessId={business.id}
            onClose={closeEmailConfigure}
            onConfigured={onEmailConfigured}
            forbidden={emailConfigureForbidden}
          />
        )}

        {canEmail && emailModalOpen && (
          <SendDocumentEmailModal
            open={emailModalOpen}
            onClose={closeEmailCompose}
            documentTable={table as DocumentTable}
            documentId={documentId}
            partyName={documentData.party_name || 'Recipient'}
            partyEmail={documentData.party_email}
            documentNumber={docNumber || documentId}
            documentDate={docDate}
            amount={documentData.grand_total ?? documentData.total_cost}
            businessName={business?.name || 'Your business'}
            fromEmail={business?.email || user?.email || ''}
            fromName={business?.name}
          />
        )}
      </div>
    </AppLayout>
  );
};

