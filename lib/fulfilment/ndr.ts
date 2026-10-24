import { getPool, queryOne } from '@/lib/db';
import { loadShiprocketCreds } from '@/lib/store/delivery';
import { createShiprocketClient, ShiprocketError } from '@/lib/store/delivery/shiprocket';
import { setFulfilmentShipping, transitionFulfilment, type FulfilmentChange } from './service';
import type { FulfilmentStatus } from './rules';

/**
 * Failed delivery (NDR) follow-up: after "could not deliver", the shop decides what happens next.
 *   reattempt         try again (optionally on a date); own riders go back on the road
 *   change_address    fix the address / phone, then try again
 *   return_to_origin  bring it back; a return opens so stock and money are settled
 * Shiprocket parcels pass the instruction to the courier; its tracking webhook then moves the status.
 */

export const NDR_ACTIONS = ['reattempt', 'change_address', 'return_to_origin'] as const;
export type NdrAction = (typeof NDR_ACTIONS)[number];

export function isNdrAction(v: unknown): v is NdrAction {
  return typeof v === 'string' && (NDR_ACTIONS as readonly string[]).includes(v);
}

export class NdrError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'NdrError';
  }
}

export async function actOnFailedDelivery(p: {
  businessId: string;
  fulfilmentId: string;
  userId: string;
  action: NdrAction;
  note?: string | null;
  reattemptDate?: string | null;
  phone?: string | null;
  address?: string | null;
  pincode?: string | null;
}): Promise<{ change: FulfilmentChange; viaCourier: boolean; returnId: string | null }> {
  const f = await queryOne<{ id: string; status: FulfilmentStatus; method: string | null; awb: string | null; buyer_phone: string | null }>(
    `SELECT id, status, method, awb, buyer_phone FROM order_fulfilments WHERE id = $1 AND business_id = $2`,
    [p.fulfilmentId, p.businessId],
  );
  if (!f) throw new NdrError(404, 'Parcel not found');
  if (f.status !== 'delivery_failed') throw new NdrError(409, 'This parcel has not failed delivery');
  if (p.action === 'change_address' && !(p.address ?? '').trim()) throw new NdrError(400, 'Enter the corrected address');
  const date = p.reattemptDate && /^\d{4}-\d{2}-\d{2}$/.test(p.reattemptDate) ? p.reattemptDate : null;
  const phone = (p.phone ?? '').replace(/\D/g, '').slice(-10) || null;

  // Courier first: if Shiprocket refuses, nothing is recorded and the shop can try again.
  const viaCourier = f.method === 'shiprocket' && !!f.awb;
  if (viaCourier) {
    const creds = await loadShiprocketCreds(p.businessId);
    if (!creds) throw new NdrError(409, 'Connect Shiprocket in Online store settings first');
    try {
      await createShiprocketClient(creds).ndrAction(f.awb!, {
        action: p.action === 'return_to_origin' ? 'return' : 're-attempt',
        comments: p.note?.trim() || (p.action === 'return_to_origin' ? 'Return to shop' : 'Please re-attempt delivery'),
        deferredDate: date,
        phone,
        address: p.action === 'change_address' ? p.address : null,
      });
    } catch (e) {
      throw new NdrError(502, e instanceof ShiprocketError ? e.message : 'Shiprocket did not accept the instruction');
    }
  }

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    if (p.action === 'change_address') {
      await setFulfilmentShipping(client, {
        businessId: p.businessId,
        fulfilmentId: f.id,
        address: p.address,
        ...(p.pincode ? { pincode: p.pincode } : {}),
      });
    }
    if (phone && phone !== (f.buyer_phone ?? '').replace(/\D/g, '').slice(-10)) {
      await client.query(`UPDATE order_fulfilments SET buyer_phone = $3 WHERE id = $1 AND business_id = $2`, [f.id, p.businessId, phone]);
    }
    await client.query(
      `UPDATE order_fulfilments
          SET ndr_action = $3, ndr_note = $4, ndr_reattempt_date = $5,
              ndr_attempts = ndr_attempts + 1, ndr_actioned_at = NOW(), updated_at = NOW()
        WHERE id = $1 AND business_id = $2`,
      [f.id, p.businessId, p.action, p.note?.trim().slice(0, 500) || null, date],
    );

    let change: FulfilmentChange = null;
    let returnId: string | null = null;
    const label =
      p.action === 'return_to_origin'
        ? 'Return to shop requested'
        : `Re-attempt${date ? ` on ${date}` : ''}${p.action === 'change_address' ? ' at the corrected address' : ''}`;
    if (!viaCourier) {
      const to: FulfilmentStatus = p.action === 'return_to_origin' ? 'returned' : 'shipped';
      const moved = await transitionFulfilment(client, {
        businessId: p.businessId,
        fulfilmentId: f.id,
        to,
        actorType: 'staff',
        actorUserId: p.userId,
        note: [label, p.note?.trim()].filter(Boolean).join(' · '),
        skipPaymentGate: true,
      });
      if (!moved.ok) throw new NdrError(moved.status, moved.error);
      change = moved.changed ? { fulfilmentId: f.id, to: moved.to } : null;
      if (to === 'returned') {
        const { ensureReturnForReturnedFulfilment } = await import('@/lib/returns/service');
        returnId = await ensureReturnForReturnedFulfilment(client, {
          businessId: p.businessId,
          fulfilmentId: f.id,
          userId: p.userId,
          wasDelivered: false,
        });
      }
    } else {
      await client.query(
        `INSERT INTO order_fulfilment_events (fulfilment_id, business_id, status, note, actor_type, actor_user_id)
         VALUES ($1, $2, 'delivery_failed', $3, 'staff', $4)`,
        [f.id, p.businessId, `${label} (sent to courier)`, p.userId],
      );
    }
    await client.query('COMMIT');
    return { change, viaCourier, returnId };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
