import type { FulfilmentChange } from './service';

/**
 * Sends the buyer update for a committed status change in the background. Loaded lazily so the
 * WhatsApp stack is not pulled into DB-only code paths.
 */
export function triggerFulfilmentNotification(businessId: string, change: FulfilmentChange | undefined): void {
  if (!change) return;
  void import('./notify')
    .then((m) => m.notifyFulfilmentStatus(businessId, change.fulfilmentId))
    .catch((err) => console.error('[fulfilment notify]', err));
}
