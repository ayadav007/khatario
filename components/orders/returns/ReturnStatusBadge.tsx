import { clsx } from 'clsx';
import { RETURN_STATUS_LABELS, type ReturnStatus } from '@/lib/returns/labels';

const TONE: Record<ReturnStatus, string> = {
  requested: 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  approved: 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  received: 'bg-violet-50 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300',
  closed: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  rejected: 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  cancelled: 'bg-slate-100 text-slate-500 line-through dark:bg-slate-800 dark:text-slate-400',
};

export function ReturnStatusBadge({ status, className }: { status: ReturnStatus; className?: string }) {
  return (
    <span className={clsx('inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium', TONE[status], className)}>
      {RETURN_STATUS_LABELS[status] ?? status}
    </span>
  );
}
