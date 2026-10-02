'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { CalendarCheck, CheckCircle, FileText, Play, Receipt, XCircle } from 'lucide-react';
import { UnifiedDocumentDetail } from '@/components/documents/UnifiedDocumentDetail';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/contexts/AuthContext';
import { useToastContext } from '@/contexts/ToastContext';
import {
  canConvertToInvoice,
  canTransition,
  isWorkOrderEditable,
  STATUS_LABELS,
  type WorkOrderStatus,
} from '@/lib/work-orders/work-order-math';

const STATUS_STYLE: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-800',
  scheduled: 'bg-slate-100 text-primary-800',
  in_progress: 'bg-yellow-100 text-yellow-800',
  completed: 'bg-green-100 text-green-800',
  cancelled: 'bg-red-100 text-red-800',
};

const SUCCESS: Record<string, string> = {
  scheduled: 'Work order scheduled',
  in_progress: 'Work started',
  completed: 'Work order completed',
  cancelled: 'Work order cancelled',
};

function WorkOrderActions({ workOrder, reload }: { workOrder: any; reload: () => void }) {
  const router = useRouter();
  const { business } = useAuth();
  const toast = useToastContext();
  const [busy, setBusy] = useState<string | null>(null);
  const status: string = workOrder.status || 'draft';

  async function move(next: WorkOrderStatus) {
    if (next === 'cancelled' && !window.confirm('Cancel this work order? This cannot be undone.')) return;
    let actualHours: string | null = null;
    if (next === 'completed') {
      actualHours = window.prompt(
        'Actual hours spent (optional)',
        workOrder.actual_hours != null ? String(Number(workOrder.actual_hours)) : ''
      );
      if (actualHours === null) return;
    }
    setBusy(next);
    try {
      const res = await fetch(`/api/work-orders/${workOrder.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next, actual_hours: actualHours || null, business_id: business?.id }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Could not update the work order');
        return;
      }
      toast.success(SUCCESS[next] || 'Work order updated');
      reload();
    } catch {
      toast.error('Could not update the work order');
    } finally {
      setBusy(null);
    }
  }

  async function createInvoice() {
    if (!window.confirm('Raise a tax invoice for this work order? Materials will be issued from stock.')) return;
    setBusy('invoice');
    try {
      const res = await fetch(`/api/work-orders/${workOrder.id}/convert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ business_id: business?.id }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Could not raise the invoice');
        if (data.invoice_id) reload();
        return;
      }
      toast.success(`Invoice ${data.invoice?.invoice_number || ''} created`.trim());
      if (data.invoice?.id) router.push(`/invoices/${data.invoice.id}`);
      else reload();
    } catch {
      toast.error('Could not raise the invoice');
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <span
        className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${STATUS_STYLE[status] || STATUS_STYLE.draft}`}
      >
        {STATUS_LABELS[status as WorkOrderStatus] || status}
      </span>
      {canTransition(status, 'scheduled') && (
        <Button size="sm" variant="secondary" onClick={() => move('scheduled')} isLoading={busy === 'scheduled'} disabled={!!busy}>
          <CalendarCheck className="w-4 h-4 mr-2" />
          Schedule
        </Button>
      )}
      {canTransition(status, 'in_progress') && (
        <Button size="sm" onClick={() => move('in_progress')} isLoading={busy === 'in_progress'} disabled={!!busy}>
          <Play className="w-4 h-4 mr-2" />
          Start Work
        </Button>
      )}
      {canTransition(status, 'completed') && (
        <Button size="sm" onClick={() => move('completed')} isLoading={busy === 'completed'} disabled={!!busy}>
          <CheckCircle className="w-4 h-4 mr-2" />
          Mark Completed
        </Button>
      )}
      {canConvertToInvoice(workOrder) && (
        <Button size="sm" onClick={createInvoice} isLoading={busy === 'invoice'} disabled={!!busy}>
          <Receipt className="w-4 h-4 mr-2" />
          Create Invoice
        </Button>
      )}
      {workOrder.converted_invoice_id && (
        <Button size="sm" variant="secondary" onClick={() => router.push(`/invoices/${workOrder.converted_invoice_id}`)}>
          <FileText className="w-4 h-4 mr-2" />
          View Invoice
        </Button>
      )}
      {canTransition(status, 'cancelled') && (
        <Button variant="secondary" size="sm" onClick={() => move('cancelled')} isLoading={busy === 'cancelled'} disabled={!!busy}>
          <XCircle className="w-4 h-4 mr-2 text-red-500" />
          Cancel
        </Button>
      )}
    </>
  );
}

export default function WorkOrderDetailPage() {
  const params = useParams();
  const id = params.id as string;

  return (
    <UnifiedDocumentDetail
      documentId={id}
      table="work_orders"
      title="Work Order"
      backUrl="/work-orders"
      editUrlPrefix="/work-orders/edit"
      canEdit={(doc) => isWorkOrderEditable(doc?.status || 'draft')}
      headerActions={(doc, reload) => <WorkOrderActions workOrder={doc} reload={reload} />}
    />
  );
}
