/** The timeline of a return, shown on every screen (website, phone, storefront). */
import type { PoolClient } from 'pg';

export type ReturnEventKind =
  | 'requested'
  | 'approved'
  | 'rejected'
  | 'pickup_booked'
  | 'pickup_status'
  | 'pickup_cancelled'
  | 'received'
  | 'refund_pending'
  | 'refunded'
  | 'refund_failed'
  | 'cancelled';

type Db = Pick<PoolClient, 'query'>;

export async function recordReturnEvent(
  client: Db,
  e: {
    businessId: string;
    returnId: string;
    kind: ReturnEventKind;
    note?: string | null;
    actorType: 'customer' | 'staff' | 'webhook' | 'system';
    actorUserId?: string | null;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO order_return_events (business_id, return_id, kind, note, actor_type, actor_user_id)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [e.businessId, e.returnId, e.kind, e.note ?? null, e.actorType, e.actorUserId ?? null],
  );
}

/** Oldest first. Scoped to the business, so another shop's return id returns nothing. */
export async function listReturnEvents(
  client: Db,
  businessId: string,
  returnId: string,
): Promise<Array<{ kind: ReturnEventKind; note: string | null; actor_type: string; created_at: string }>> {
  const r = await client.query(
    `SELECT kind, note, actor_type, created_at
       FROM order_return_events
      WHERE business_id = $1 AND return_id = $2
      ORDER BY created_at, id`,
    [businessId, returnId],
  );
  return r.rows;
}
