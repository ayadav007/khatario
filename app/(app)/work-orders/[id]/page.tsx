'use client';

import { useParams } from 'next/navigation';
import { UnifiedDocumentDetail } from '@/components/documents/UnifiedDocumentDetail';

export default function WorkOrderDetailPage() {
  const params = useParams();
  const id = params.id as string;

  return (
    <UnifiedDocumentDetail
      documentId={id}
      table="work_orders"
      title="Work Order"
      backUrl="/work-orders"
      editUrlPrefix="/work-orders/new"
    />
  );
}

