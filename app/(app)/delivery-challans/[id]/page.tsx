'use client';

import { useParams } from 'next/navigation';
import { UnifiedDocumentDetail } from '@/components/documents/UnifiedDocumentDetail';

export default function DeliveryChallanDetailPage() {
  const params = useParams();
  const id = params.id as string;

  return (
    <UnifiedDocumentDetail
      documentId={id}
      table="delivery_challans"
      title="Delivery Challan"
      backUrl="/delivery-challans"
      editUrlPrefix="/delivery-challans/new"
    />
  );
}

