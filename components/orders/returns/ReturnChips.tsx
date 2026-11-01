import { PICKUP_STATUS_LABELS, type PickupStatus } from '@/lib/returns/labels';

/** The extra chips on a return row: where the pickup stands, and a refund still on its way. */
export function ReturnChips({
  pickupStatus,
  refundPending,
}: {
  pickupStatus?: PickupStatus | null;
  refundPending?: boolean;
}) {
  if (!pickupStatus && !refundPending) return null;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {pickupStatus ? (
        <span
          className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${
            pickupStatus === 'pickup_issue'
              ? 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
              : pickupStatus === 'arrived'
                ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                : 'bg-sky-50 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300'
          }`}
        >
          {PICKUP_STATUS_LABELS[pickupStatus] ?? pickupStatus}
        </span>
      ) : null}
      {refundPending ? (
        <span className="inline-flex rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
          Refund pending
        </span>
      ) : null}
    </span>
  );
}
