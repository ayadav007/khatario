/**
 * Client-side POST to /api/invoices/extract (shared by InvoiceUploader and scan hub).
 */

export type InvoiceExtractApiSuccess = {
  success: true;
  job_id?: string;
  data: unknown;
  extraction_method?: string;
  processing_time_ms?: number;
  [key: string]: unknown;
};

export async function postInvoiceExtract(
  file: File,
  businessId: string
): Promise<InvoiceExtractApiSuccess> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('business_id', businessId);

  const response = await fetch('/api/invoices/extract', {
    method: 'POST',
    credentials: 'include',
    body: formData,
  });

  const data = (await response.json().catch(() => ({}))) as {
    success?: boolean;
    error?: string;
    [key: string]: unknown;
  };

  if (!response.ok) {
    const msg =
      typeof data.error === 'string'
        ? data.error
        : response.status === 503
          ? 'Extraction service unavailable. Check configuration.'
          : 'Failed to extract invoice data';
    throw new Error(msg);
  }

  if (!data.success) {
    throw new Error(typeof data.error === 'string' ? data.error : 'Extraction failed');
  }

  return data as InvoiceExtractApiSuccess;
}
