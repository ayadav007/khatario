'use client';

export const dynamic = 'force-dynamic';

import { useParams } from 'next/navigation';
import { WorkOrderForm } from '@/components/work-orders/WorkOrderForm';

export default function EditWorkOrderPage() {
  const params = useParams();
  return <WorkOrderForm editId={params.id as string} />;
}
