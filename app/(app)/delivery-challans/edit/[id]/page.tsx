'use client';

export const dynamic = 'force-dynamic';

import { useParams } from 'next/navigation';
import { DeliveryChallanForm } from '@/components/delivery-challans/DeliveryChallanForm';

export default function EditDeliveryChallanPage() {
  const params = useParams();
  return <DeliveryChallanForm editId={params.id as string} />;
}
