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
import type { DocumentTable } from '@/lib/pdf-generator';
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
}

export const UnifiedDocumentDetail: React.FC<UnifiedDocumentDetailProps> = ({
  documentId,
  table,
  title,
  backUrl,
  editUrlPrefix,
  pdfUrlPrefix = '/api/documents',
  topContent,
}) => {
  const router = useRouter();
  const { business, user } = useAuth();
  const toast = useToastContext();
  
  const [documentData, setDocumentData] = useState<any>(null);
  const [html, setHtml] = useState('');
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [emailModalOpen, setEmailModalOpen] = useState(false);

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
      a.download = `${documentData?.invoice_number || documentData?.order_number || documentData?.challan_number || 'document'}.pdf`;
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
            { label: documentData.invoice_number || documentData.order_number || documentData.challan_number || 'Detail' }
          ]} />
        </div>

        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-4 rounded-xl border border-border shadow-sm no-print">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => router.push(backUrl)}>
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <div>
              <h1 className="text-xl font-bold text-gray-900">
                {title} {documentData.invoice_number || documentData.order_number || documentData.challan_number}
              </h1>
              <p className="text-sm text-gray-500">
                {documentData.party_name} • {new Date(documentData.invoice_date || documentData.order_date || documentData.challan_date).toLocaleDateString()}
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
            <Button variant="secondary" size="sm" onClick={() => router.push(`${editUrlPrefix}/${documentId}?edit=true`)}>
              <Edit className="w-4 h-4 mr-2" />
              Edit
            </Button>
            {canEmail && (
              <Button variant="secondary" size="sm" onClick={() => setEmailModalOpen(true)}>
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
            <div
              className="bg-white shadow-lg my-8 p-[1in] w-[210mm] min-h-[297mm] print:shadow-none print:my-0 print:p-0 print:w-full"
              dangerouslySetInnerHTML={{ __html: html }}
            />
          )}
        </Card>

        {canEmail && emailModalOpen && (
          <SendDocumentEmailModal
            open={emailModalOpen}
            onClose={() => setEmailModalOpen(false)}
            documentTable={table as DocumentTable}
            documentId={documentId}
            partyName={documentData.party_name || 'Recipient'}
            partyEmail={documentData.party_email}
            documentNumber={
              documentData.invoice_number ||
              documentData.order_number ||
              documentData.challan_number ||
              documentId
            }
            documentDate={
              documentData.invoice_date || documentData.order_date || documentData.challan_date
            }
            amount={documentData.grand_total}
            businessName={business?.name || 'Your business'}
            fromEmail={business?.email || user?.email || ''}
            fromName={business?.name}
          />
        )}
      </div>
    </AppLayout>
  );
};

