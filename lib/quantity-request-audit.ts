import * as db from '@/lib/db';

export type QuantityRequestEventType =
  | 'created'
  | 'responded'
  | 'mapping_updated'
  | 'document_linked'
  | 'spawn_upstream';

/**
 * Best-effort audit insert; failures are logged and do not fail the main transaction.
 */
export async function logQuantityRequestEvent(params: {
  quantityRequestId: string;
  businessId: string;
  actorUserId: string | null;
  eventType: QuantityRequestEventType;
  payload?: Record<string, unknown>;
}): Promise<void> {
  try {
    await db.query(
      `
      INSERT INTO quantity_request_events (
        quantity_request_id, business_id, actor_user_id, event_type, payload
      )
      VALUES ($1, $2, $3, $4, $5::jsonb)
      `,
      [
        params.quantityRequestId,
        params.businessId,
        params.actorUserId,
        params.eventType,
        JSON.stringify(params.payload ?? {}),
      ]
    );
  } catch (e) {
    console.error('[quantity_request_events] insert failed:', e);
  }
}
