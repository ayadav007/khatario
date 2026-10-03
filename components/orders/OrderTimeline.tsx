import { clsx } from 'clsx';
import { FULFILMENT_STATUS_LABEL, isFulfilmentStatus, type FulfilmentStatus } from '@/lib/fulfilment/rules';

export interface TimelineEvent {
  status: string;
  note?: string | null;
  created_at: string;
}

const DELIVERY_PATH: FulfilmentStatus[] = ['confirmed', 'packed', 'shipped', 'out_for_delivery', 'delivered'];
const PICKUP_PATH: FulfilmentStatus[] = ['confirmed', 'packed', 'ready_for_pickup', 'delivered'];
const PROBLEM: ReadonlySet<string> = new Set(['delivery_failed', 'returned', 'cancelled']);

function when(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

/**
 * Steps already taken (from the event log) followed by the steps still to come. Used on the
 * Orders drawer, the public tracking page and the store account page.
 */
export function OrderTimeline({
  events,
  current,
  pickup,
  showNotes = true,
}: {
  events: TimelineEvent[];
  current: string | null;
  pickup?: boolean;
  showNotes?: boolean;
}) {
  const path = pickup ? PICKUP_PATH : DELIVERY_PATH;
  const done = events.filter((e) => isFulfilmentStatus(e.status));
  const seen = new Set(done.map((e) => e.status));
  const finished = current === 'delivered' || (current != null && PROBLEM.has(current) && current !== 'delivery_failed');
  const currentIdx = current ? path.indexOf(current as FulfilmentStatus) : -1;
  const upcoming = finished
    ? []
    : path.filter((s, i) => !seen.has(s) && (currentIdx < 0 || i > currentIdx) && s !== 'packed');

  return (
    <ol className="relative space-y-3 border-l border-slate-200 pl-5 dark:border-slate-700">
      {done.map((e, i) => {
        const problem = PROBLEM.has(e.status);
        const latest = i === done.length - 1;
        return (
          <li key={`${e.status}-${e.created_at}-${i}`} className="relative">
            <span
              className={clsx(
                'absolute -left-[27px] top-1 h-3 w-3 rounded-full ring-4 ring-white dark:ring-slate-900',
                problem ? 'bg-red-500' : latest ? 'bg-emerald-500' : 'bg-emerald-300',
              )}
            />
            <div className={clsx('text-sm font-medium', problem ? 'text-red-700 dark:text-red-300' : 'text-slate-900 dark:text-slate-100')}>
              {FULFILMENT_STATUS_LABEL[e.status as FulfilmentStatus]}
            </div>
            <div className="text-xs text-slate-500">{when(e.created_at)}</div>
            {showNotes && e.note ? <div className="mt-0.5 text-xs text-slate-600 dark:text-slate-300">{e.note}</div> : null}
          </li>
        );
      })}
      {upcoming.map((s) => (
        <li key={`up-${s}`} className="relative">
          <span className="absolute -left-[27px] top-1 h-3 w-3 rounded-full border-2 border-slate-300 bg-white dark:border-slate-600 dark:bg-slate-900" />
          <div className="text-sm text-slate-400">{FULFILMENT_STATUS_LABEL[s]}</div>
        </li>
      ))}
    </ol>
  );
}
