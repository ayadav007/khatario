import type { OfflineActionType } from '@/lib/offline/types';

/** Lower runs first — dependent offline actions must replay in order. */
export const OFFLINE_ACTION_PRIORITY: Partial<Record<OfflineActionType, number>> = {
  'purchase.create': 10,
  'purchase.update': 15,
  'purchase.finalize': 20,
  'sales.create': 25,
  'sales.update': 28,
  'sales.finalize': 30,
  'stock.adjust': 35,
  'payment.record': 40,
};

export function compareOfflineActions(
  a: { type: OfflineActionType; sequence: number },
  b: { type: OfflineActionType; sequence: number }
): number {
  const pa = OFFLINE_ACTION_PRIORITY[a.type] ?? 50;
  const pb = OFFLINE_ACTION_PRIORITY[b.type] ?? 50;
  if (pa !== pb) return pa - pb;
  return a.sequence - b.sequence;
}
