'use client';

export const dynamic = 'force-dynamic';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { format } from 'date-fns';
import { Loader2 } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { MobileDuplicatePageChrome } from '@/components/layout/MobileDuplicatePageChrome';
import { useAuth } from '@/contexts/AuthContext';
import { useToastContext } from '@/contexts/ToastContext';
import { getApiErrorMessage, safeJsonParse } from '@/lib/api-utils';
import type { RepackDetail } from '@/lib/repack-service';

const REASON_LABELS: Record<string, string> = {
  SPILLAGE: 'Spillage',
  MOISTURE: 'Drying / moisture',
  PACKAGING: 'Packet weight',
  OTHER: 'Other',
};

const fmt = (n: number) => String(Math.round(Number(n) * 1000) / 1000);
const rupees = (n: number) =>
  `₹${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-2 border-b border-gray-100 last:border-0 text-sm">
      <span className="text-gray-500">{label}</span>
      <span className="text-right text-gray-900">{children}</span>
    </div>
  );
}

export default function RepackDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { business } = useAuth();
  const toast = useToastContext();
  const [repack, setRepack] = useState<RepackDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const load = useCallback(async () => {
    if (!business?.id || !params?.id) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/inventory-adjustments/repacks/${params.id}`, { credentials: 'include' });
      const data = await safeJsonParse<{ repack?: RepackDetail }>(res);
      setRepack(res.ok && data?.repack ? data.repack : null);
    } finally {
      setLoading(false);
    }
  }, [business?.id, params?.id]);

  useEffect(() => {
    load();
  }, [load]);

  const cancel = async () => {
    if (!repack) return;
    setCancelling(true);
    try {
      const res = await fetch(`/api/inventory-adjustments/repacks/${repack.id}/cancel`, {
        method: 'POST',
        credentials: 'include',
      });
      const data = await safeJsonParse<{ repack?: RepackDetail; error?: string }>(res);
      if (!res.ok) {
        toast.error(getApiErrorMessage(data, 'Could not cancel the repack'));
        return;
      }
      toast.success(`${repack.repack_number} cancelled; stock put back`);
      if (data?.repack) setRepack(data.repack);
      setConfirming(false);
    } finally {
      setCancelling(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="w-6 h-6 animate-spin text-primary-500" />
      </div>
    );
  }
  if (!repack) {
    return (
      <div className="max-w-2xl mx-auto text-center py-16 text-gray-500">
        <p>Repack not found.</p>
        <Button variant="ghost" className="mt-4" onClick={() => router.push('/inventory-adjustments')}>
          Back to adjustments
        </Button>
      </div>
    );
  }

  const unit = repack.source_unit || '';
  const cancelled = repack.status === 'cancelled';

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <MobileDuplicatePageChrome
        title={repack.repack_number}
        description={`Repack on ${format(new Date(repack.repack_date), 'dd MMM yyyy')}${cancelled ? ' · cancelled' : ''}`}
        trailing={
          !cancelled ? (
            <Link href={`/inventory-adjustments/repacks/new?item_id=${repack.packed_item_id}`}>
              <Button variant="secondary">Repack again</Button>
            </Link>
          ) : undefined
        }
      />

      {cancelled && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          This repack was cancelled and both items were put back.
        </div>
      )}

      <Card>
        <div className="p-4 sm:p-6">
          <Row label="Took out">
            {fmt(repack.source_qty)} {unit}{' '}
            <Link className="text-primary-600" href={`/items/${repack.source_item_id}`}>
              {repack.source_name}
            </Link>
          </Row>
          <Row label="Made">
            {fmt(repack.packed_qty)}{' '}
            <Link className="text-primary-600" href={`/items/${repack.packed_item_id}`}>
              {repack.packed_name}
            </Link>{' '}
            <span className="text-gray-500">
              ({fmt(repack.content_per_unit)} {unit.toLowerCase()} each)
            </span>
          </Row>
          <Row label="Wastage">
            {repack.wastage_qty > 0 ? (
              <>
                {fmt(repack.wastage_qty)} {unit} (
                {Math.round((repack.wastage_qty / repack.source_qty) * 1000) / 10}%) ·{' '}
                {REASON_LABELS[repack.wastage_reason || ''] || repack.wastage_reason}
                {repack.wastage_notes ? `: ${repack.wastage_notes}` : ''}
              </>
            ) : (
              'None'
            )}
          </Row>
          <Row label="Cost carried">
            {rupees(repack.total_cost)} · <strong>{rupees(repack.unit_cost)}</strong> per pack
          </Row>
          {(repack.location_name || repack.branch_name) && (
            <Row label={repack.location_name ? 'Warehouse' : 'Branch'}>{repack.location_name || repack.branch_name}</Row>
          )}
          {repack.notes && <Row label="Note">{repack.notes}</Row>}
          <Row label="By">{repack.created_by_name || '-'}</Row>
          <p className="mt-4 text-xs text-gray-500">
            Wastage cost stays in the packs. No tax entry: repacking your own stock is not a sale.
          </p>
        </div>
      </Card>

      {!cancelled && (
        <div className="flex justify-end gap-2">
          {confirming ? (
            <>
              <span className="self-center text-sm text-gray-600">
                Put back {fmt(repack.source_qty)} {unit} and remove {fmt(repack.packed_qty)} packs?
              </span>
              <Button variant="ghost" onClick={() => setConfirming(false)} disabled={cancelling}>
                Keep
              </Button>
              <Button variant="destructive" onClick={cancel} disabled={cancelling}>
                {cancelling && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Cancel repack
              </Button>
            </>
          ) : (
            <Button variant="ghost" onClick={() => setConfirming(true)}>
              Cancel repack
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
