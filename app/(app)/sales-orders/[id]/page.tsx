'use client';

import { useParams } from 'next/navigation';
import { UnifiedDocumentDetail } from '@/components/documents/UnifiedDocumentDetail';
import { SalesOrderPaymentSection } from '@/components/documents/SalesOrderPaymentSection';
import { SalesOrderPaymentTransactionsPanel } from '@/components/documents/SalesOrderPaymentTransactionsPanel';

export default function SalesOrderDetailPage() {
  const params = useParams();
  const id = params.id as string;

  return (
    <UnifiedDocumentDetail
      documentId={id}
      table="sales_orders"
      title="Sales Order"
      backUrl="/sales-orders"
      editUrlPrefix="/sales-orders/new"
      topContent={
        <div className="space-y-4">
          <SalesOrderPaymentSection orderId={id} />
          <SalesOrderPaymentTransactionsPanel orderId={id} />
        </div>
      }
    />
  );
}

