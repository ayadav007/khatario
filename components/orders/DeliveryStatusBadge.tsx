import { clsx } from 'clsx';
import { FULFILMENT_STATUS_LABEL, isFulfilmentStatus, type FulfilmentStatus } from '@/lib/fulfilment/rules';

const TONE: Record<FulfilmentStatus, string> = {
  new: 'bg-slate-100 text-slate-700 dark:bg-slate-700/60 dark:text-slate-200',
  confirmed: 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  packed: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300',
  ready_for_pickup: 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  shipped: 'bg-violet-50 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300',
  out_for_delivery: 'bg-cyan-50 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300',
  delivered: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  delivery_failed: 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  returned: 'bg-orange-50 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
  cancelled: 'bg-slate-100 text-slate-500 line-through dark:bg-slate-800 dark:text-slate-400',
};

export function DeliveryStatusBadge({ status, className }: { status: unknown; className?: string }) {
  if (!isFulfilmentStatus(status)) {
    return (
      <span className={clsx('inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium text-slate-400', className)}>
        Not tracked
      </span>
    );
  }
  return (
    <span className={clsx('inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium', TONE[status], className)}>
      {FULFILMENT_STATUS_LABEL[status]}
    </span>
  );
}
