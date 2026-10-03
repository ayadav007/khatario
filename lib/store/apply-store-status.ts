import { query } from '@/lib/db';
import { resolveDeliveryProvider } from '@/lib/store/delivery';
import { createInvoiceForStoreOrder } from '@/lib/store/fulfill-paid-order';
import { bookStoreCourierIfNeeded, markSelfDispatch } from '@/lib/store/book-store-shipment';
import { syncStoreFulfilment, transitionStoreOrder, type StoreOrderLifecycleResult } from './order-lifecycle';
import type { StoreOrderStatus } from './fulfillment-rules';
import { triggerFulfilmentNotification } from '@/lib/fulfilment/notify-trigger';

export type StoreDispatchMode = 'pickup' | 'self' | 'shiprocket';

/**
 * A merchant's status change on a store order with everything that follows it: the invoice on
 * confirm, courier booking or self dispatch on ready, shipment cancel, the delivery record and the
 * buyer update. Throws InvoiceCancelError when a cancel cannot reverse the invoice.
 */
export async function applyStoreOrderStatus(input: {
  businessId: string;
  orderId: string;
  to: StoreOrderStatus;
  dispatchMode: StoreDispatchMode | null;
  cancelledReason: string | null;
  actorUserId: string | null;
}): Promise<{ moved: StoreOrderLifecycleResult; invoiceError: string | null }> {
  const { businessId, orderId, to, dispatchMode, actorUserId } = input;
  const moved = await transitionStoreOrder({
    businessId,
    orderId,
    to,
    cancelledReason: input.cancelledReason,
    dispatchMode,
    actorUserId,
  });
  if (!moved.ok) return { moved, invoiceError: null };

  if (to === 'cancelled' && moved.shipmentId && moved.shipmentId !== 'self') {
    try {
      const provider = await resolveDeliveryProvider(businessId);
      await provider.cancelShipment?.(moved.shipmentId);
    } catch (err) {
      console.error('[store cancel shipment]', err);
    }
  }

  let invoiceError: string | null = null;
  if (to === 'confirmed') {
    try {
      await createInvoiceForStoreOrder(orderId, businessId, actorUserId);
    } catch (err) {
      console.error('[store invoice on confirm]', err);
      invoiceError = err instanceof Error ? err.message : 'The sale could not be posted to the accounts';
    }
  }

  if (to === 'ready') {
    if (dispatchMode === 'self' || dispatchMode === 'pickup') {
      await markSelfDispatch(orderId, businessId);
      if (dispatchMode === 'pickup') {
        await query(
          `UPDATE store_orders SET dispatch_mode = 'pickup', updated_at = CURRENT_TIMESTAMP
           WHERE id = $1 AND business_id = $2`,
          [orderId, businessId],
        );
      }
    } else {
      await bookStoreCourierIfNeeded(orderId, businessId);
    }
  }

  await syncStoreFulfilmentQuietly(businessId, orderId, actorUserId);
  triggerFulfilmentNotification(businessId, moved.fulfilment);
  return { moved, invoiceError };
}

/** The store order is already saved; a delivery-record hiccup must not fail the merchant's action. */
export async function syncStoreFulfilmentQuietly(
  businessId: string,
  orderId: string,
  actorUserId: string | null,
): Promise<void> {
  try {
    await syncStoreFulfilment(businessId, orderId, actorUserId);
  } catch (err) {
    console.error('[store fulfilment sync]', err);
  }
}
