'use client';

import { useParams } from 'next/navigation';
import { UnifiedDocumentDetail } from '@/components/documents/UnifiedDocumentDetail';

export default function CreditNoteDetailPage() {
  const params = useParams();
  const id = params.id as string;

  return (
    <UnifiedDocumentDetail
      documentId={id}
      table="credit_notes"
      title="Credit Note"
      backUrl="/credit-notes"
      editUrlPrefix="/credit-notes/new"
    />
  );
}

