'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { CheckCircle, Send, XCircle } from 'lucide-react';
import { UnifiedDocumentDetail } from '@/components/documents/UnifiedDocumentDetail';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/contexts/AuthContext';
import { useToastContext } from '@/contexts/ToastContext';
import { canTransition, isChallanEditable } from '@/lib/delivery-challans/challan-math';

const STATUS_STYLE: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-800',
  sent: 'bg-slate-100 text-primary-800',
  delivered: 'bg-green-100 text-green-800',
  cancelled: 'bg-red-100 text-red-800',
};

function ChallanStatusActions({ challan, reload }: { challan: any; reload: () => void }) {
  const { business } = useAuth();
  const toast = useToastContext();
  const [busy, setBusy] = useState<string | null>(null);
  const status: string = challan.status || 'draft';

  async function move(next: 'sent' | 'delivered' | 'cancelled') {
    if (next === 'cancelled' && !window.confirm('Cancel this delivery challan? This cannot be undone.')) return;
    setBusy(next);
    try {
      const res = await fetch(`/api/delivery-challans/${challan.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next, business_id: business?.id }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Could not update the challan');
        return;
      }
      toast.success(
        next === 'sent' ? 'Challan generated' : next === 'delivered' ? 'Marked as delivered' : 'Challan cancelled'
      );
      reload();
    } catch {
      toast.error('Could not update the challan');
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <span
        className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium capitalize ${STATUS_STYLE[status] || STATUS_STYLE.draft}`}
      >
        {status}
      </span>
      {canTransition(status, 'sent') && (
        <Button size="sm" onClick={() => move('sent')} isLoading={busy === 'sent'} disabled={!!busy}>
          <Send className="w-4 h-4 mr-2" />
          Generate
        </Button>
      )}
      {canTransition(status, 'delivered') && (
        <Button size="sm" onClick={() => move('delivered')} isLoading={busy === 'delivered'} disabled={!!busy}>
          <CheckCircle className="w-4 h-4 mr-2" />
          Mark Delivered
        </Button>
      )}
      {canTransition(status, 'cancelled') && (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => move('cancelled')}
          isLoading={busy === 'cancelled'}
          disabled={!!busy}
        >
          <XCircle className="w-4 h-4 mr-2 text-red-500" />
          Cancel
        </Button>
      )}
    </>
  );
}

export default function DeliveryChallanDetailPage() {
  const params = useParams();
  const id = params.id as string;

  return (
    <UnifiedDocumentDetail
      documentId={id}
      table="delivery_challans"
      title="Delivery Challan"
      backUrl="/delivery-challans"
      editUrlPrefix="/delivery-challans/edit"
      canEdit={(doc) => isChallanEditable(doc?.status || 'draft')}
      headerActions={(doc, reload) => <ChallanStatusActions challan={doc} reload={reload} />}
    />
  );
}
