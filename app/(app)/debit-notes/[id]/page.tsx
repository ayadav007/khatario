'use client';

import { useParams } from 'next/navigation';
import { UnifiedDocumentDetail } from '@/components/documents/UnifiedDocumentDetail';

export default function DebitNoteDetailPage() {
  const params = useParams();
  const id = params.id as string;

  return (
    <UnifiedDocumentDetail
      documentId={id}
      table="debit_notes"
      title="Debit Note"
      backUrl="/debit-notes"
      editUrlPrefix="/debit-notes/new"
    />
  );
}

