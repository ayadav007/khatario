'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { CheckCircle, FileText, PackageCheck, Send, XCircle } from 'lucide-react';
import { UnifiedDocumentDetail } from '@/components/documents/UnifiedDocumentDetail';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/contexts/AuthContext';
import { useToastContext } from '@/contexts/ToastContext';
import { canTransition, isChallanEditable } from '@/lib/delivery-challans/challan-math';
import { ChallanReturnPanel } from '@/components/delivery-challans/ChallanReturnPanel';
import { toDateInputValue } from '@/lib/date-input';
import { EwayBillPanel } from '@/components/eway-bills/EwayBillPanel';

const PURPOSE_LABEL: Record<string, string> = {
  repair: 'repair',
  job_work: 'job work',
  approval: 'approval',
  consignment: 'consignment',
  exhibition: 'exhibition',
  demo: 'demo',
  other: 'other',
};

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
  const [returnOpen, setReturnOpen] = useState(false);
  const [ewayOpen, setEwayOpen] = useState(false);
  const status: string = challan.status || 'draft';
  const returnable = challan.challan_kind === 'returnable';
  const goodsOut = returnable && !!challan.stock_posted_at && !challan.closed_at;
  const fromTransfer = !!challan.stock_transfer_id;

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
        next === 'sent'
          ? returnable
            ? 'Goods sent out; they now show as held by the party'
            : 'Challan generated'
          : next === 'delivered'
            ? 'Marked as delivered'
            : 'Challan cancelled'
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
      {returnable && (
        <span className="inline-flex items-center rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800">
          {challan.closed_at
            ? `Returnable: closed (${challan.close_reason || 'returned'})`
            : challan.stock_posted_at
              ? `Out for ${PURPOSE_LABEL[challan.purpose] || challan.purpose}${challan.expected_return_date ? `, due ${toDateInputValue(challan.expected_return_date)}` : ''}`
              : `Returnable: ${PURPOSE_LABEL[challan.purpose] || challan.purpose}`}
        </span>
      )}
      {fromTransfer && (
        <Link
          href={`/stock-transfers/${challan.stock_transfer_id}`}
          className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-800 hover:underline"
          title="Goods moved between your own godowns on one GSTIN: not a supply, no tax"
        >
          Stock transfer challan
        </Link>
      )}
      {canTransition(status, 'sent') && (
        <Button size="sm" onClick={() => move('sent')} isLoading={busy === 'sent'} disabled={!!busy}>
          <Send className="w-4 h-4 mr-2" />
          {returnable ? 'Send goods out' : 'Generate'}
        </Button>
      )}
      {goodsOut && (
        <Button size="sm" onClick={() => setReturnOpen(true)} disabled={!!busy}>
          <PackageCheck className="w-4 h-4 mr-2" />
          Record return
        </Button>
      )}
      {status !== 'cancelled' && (
        <Button
          variant="secondary"
          size="sm"
          disabled={!!busy}
          title="Part A for the e-way bill portal's bulk upload"
          onClick={() => {
            const km = window.prompt('Distance to the destination, in km?');
            if (km === null || km.trim() === '') return;
            window.location.href = `/api/eway-bills/export?source_type=delivery_challan&source_id=${challan.id}&distance_km=${encodeURIComponent(km.trim())}`;
          }}
        >
          <FileText className="w-4 h-4 mr-2" />
          E-way bill JSON
        </Button>
      )}
      {status !== 'cancelled' && (
        <Button variant="secondary" size="sm" onClick={() => setEwayOpen(true)} disabled={!!busy}>
          <FileText className="w-4 h-4 mr-2" />
          {challan.e_way_bill_number ? 'Add another e-way bill' : 'Record e-way bill'}
        </Button>
      )}
      {!returnable && canTransition(status, 'delivered') && (
        <Button size="sm" onClick={() => move('delivered')} isLoading={busy === 'delivered'} disabled={!!busy}>
          <CheckCircle className="w-4 h-4 mr-2" />
          Mark Delivered
        </Button>
      )}
      {canTransition(status, 'cancelled') && !goodsOut && !fromTransfer && (
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
      <ChallanReturnPanel
        challanId={challan.id}
        businessId={business?.id}
        purpose={challan.purpose}
        open={returnOpen}
        onClose={() => setReturnOpen(false)}
        onDone={reload}
      />
      <EwayBillPanel
        open={ewayOpen}
        onClose={() => setEwayOpen(false)}
        onDone={reload}
        sourceType="delivery_challan"
        sourceId={challan.id}
        defaults={{
          doc_type: 'delivery_challan',
          sub_supply_type:
            challan.purpose === 'job_work'
              ? 'job_work'
              : challan.purpose === 'exhibition'
                ? 'exhibition'
                : returnable
                  ? 'others'
                  : fromTransfer
                    ? 'own_use'
                    : 'supply',
          goods_value: Number(challan.grand_total) || undefined,
          vehicle_number: challan.vehicle_number,
        }}
      />
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
      canEdit={(doc) => isChallanEditable(doc?.status || 'draft') && !doc?.stock_posted_at && !doc?.stock_transfer_id}
      headerActions={(doc, reload) => <ChallanStatusActions challan={doc} reload={reload} />}
    />
  );
}
