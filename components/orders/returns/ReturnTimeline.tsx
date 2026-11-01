import type { ReactNode } from 'react';

export interface ReturnEventRow {
  kind: string;
  note: string | null;
  actor_type?: string;
  created_at: string;
}

const KIND_LABELS: Record<string, string> = {
  requested: 'Return requested',
  approved: 'Approved',
  rejected: 'Rejected',
  pickup_booked: 'Pickup booked',
  pickup_status: 'Pickup update',
  pickup_cancelled: 'Pickup cancelled',
  received: 'Received at the shop',
  refund_pending: 'Refund on its way',
  refunded: 'Refunded',
  refund_failed: 'Refund failed',
  cancelled: 'Cancelled',
};

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

/** What happened to a return, oldest first. */
export function ReturnTimeline({ events }: { events: ReturnEventRow[] }): ReactNode {
  if (!events || events.length === 0) return null;
  return (
    <section>
      <h3 className="mb-2 text-sm font-semibold">Timeline</h3>
      <ol className="space-y-2 border-l border-slate-200 pl-4 dark:border-slate-700">
        {events.map((e, i) => (
          <li key={`${e.kind}-${e.created_at}-${i}`} className="relative">
            <span className="absolute -left-[1.3rem] top-1.5 h-2 w-2 rounded-full bg-slate-400 dark:bg-slate-500" />
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
              <span className="font-medium">{KIND_LABELS[e.kind] ?? e.kind}</span>
              <span className="text-xs text-slate-500">{when(e.created_at)}</span>
            </div>
            {e.note ? <div className="text-xs text-slate-500">{e.note}</div> : null}
          </li>
        ))}
      </ol>
    </section>
  );
}
