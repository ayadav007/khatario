'use client';

import { ExternalLink, Truck } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { PICKUP_STATUS_LABELS, type PickupStatus } from '@/lib/returns/labels';

/** The pickup fields of a return (from GET /api/returns/:id). */
export interface ReturnPickupInfo {
  pickup_status: PickupStatus | null;
  carrier_order_id: string | null;
  awb: string | null;
  courier_name: string | null;
  tracking_url: string | null;
  pickup_error: string | null;
}

const LIVE: PickupStatus[] = ['booked', 'out_for_pickup', 'pickup_issue'];

/** True while a booked courier can still be called off (not yet picked up). */
export function hasLivePickup(r: Pick<ReturnPickupInfo, 'pickup_status' | 'carrier_order_id'>): boolean {
  return Boolean(r.carrier_order_id) && r.pickup_status !== null && LIVE.includes(r.pickup_status);
}

const TONE: Record<PickupStatus, string> = {
  booked: 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  out_for_pickup: 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  pickup_issue: 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  in_transit: 'bg-violet-50 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300',
  arrived: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  cancelled: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
};

/** Courier pickup of an approved return: where it stands, the AWB, Track, and the ways to fix or change it. */
export function ReturnPickupCard({
  ret,
  onAction,
  busy,
}: {
  ret: ReturnPickupInfo;
  onAction: (body: Record<string, unknown>) => void;
  busy?: boolean;
}) {
  const status = ret.pickup_status;
  const live = hasLivePickup(ret);
  const onItsWay = status === 'in_transit' || status === 'arrived';

  return (
    <section className="space-y-2.5 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
      <div className="flex flex-wrap items-center gap-2">
        <Truck className="h-4 w-4 text-slate-500" />
        <h3 className="text-sm font-semibold">Courier pickup</h3>
        {status ? (
          <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${TONE[status]}`}>{PICKUP_STATUS_LABELS[status]}</span>
        ) : (
          <span className="inline-flex rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
            Not booked yet
          </span>
        )}
      </div>

      {ret.awb ? (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span>
            <span className="text-slate-500">{ret.courier_name || 'Courier'} · AWB </span>
            <span className="font-medium tabular-nums">{ret.awb}</span>
          </span>
          {ret.tracking_url ? (
            <a
              href={ret.tracking_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
            >
              Track <ExternalLink className="h-3 w-3" />
            </a>
          ) : null}
        </div>
      ) : null}

      {ret.pickup_error ? <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{ret.pickup_error}</div> : null}

      {!onItsWay ? (
        <div className="flex flex-wrap gap-2">
          {!live ? (
            <Button size="sm" isLoading={busy} onClick={() => onAction({ action: 'book_pickup' })}>
              Book again
            </Button>
          ) : null}
          {live ? (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => onAction({ action: 'cancel_pickup' })}>
              Cancel pickup
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => onAction({ action: 'set_method', method: 'customer_sends' })}>
            Customer will send it instead
          </Button>
        </div>
      ) : null}
    </section>
  );
}
