'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { Loader2 } from 'lucide-react';

export default function EditInvoicePage() {
  const params = useParams();
  const router = useRouter();
  const invoiceId = params.id as string;

  useEffect(() => {
    // Validate invoiceId exists
    if (!invoiceId) {
      router.push('/invoices');
      return;
    }

    // Fetch invoice to get document_type for proper redirect
    fetch(`/api/invoices/${invoiceId}`)
      .then(res => res.json())
      .then(data => {
        const invoice = data.invoice || data;
        const documentType = invoice.document_type || 'tax_invoice';
        // Redirect with document type to prevent form reset
        router.replace(`/invoices/new?edit=${invoiceId}&type=${documentType}`);
      })
      .catch(() => {
        // Fallback if fetch fails
    router.replace(`/invoices/new?edit=${invoiceId}`);
      });
  }, [invoiceId, router]);

  // Show loading while redirecting
  return (
    
      <div className="flex items-center justify-center h-[60vh]">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-primary-500 mx-auto mb-4" />
          <p className="text-gray-600">Loading invoice editor...</p>
        </div>
      </div>
    
  );
}

