import type { PoolClient } from 'pg';
import { createReturn, receiveReturn, ReturnError, type RefundChoice } from '@/lib/returns/service';

/**
 * Order edit before packing (Shopify "Edit order"). A final bill cannot be changed under GST, so
 * taking items off a billed order posts a credit note for them (stock back on the shelf) and the
 * parcel stops carrying them. Paid money is kept as credit unless the shop pays it back.
 * Adding items is a new bill for the same customer.
 */

export class OrderEditError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'OrderEditError';
  }
}

const NOT_PACKED = ['new', 'confirmed'];

export async function removeItemsBeforePacking(
  client: PoolClient,
  p: {
    businessId: string;
    userId: string;
    invoiceId: string;
    fulfilmentIds: string[];
    lines: Array<{ invoice_item_id: string; quantity: number }>;
    note?: string | null;
    refund?: RefundChoice | null;
  },
): Promise<{ returnId: string; creditNoteNumber: string; creditAmount: number; refundable: number }> {
  if (p.fulfilmentIds.length > 0) {
    const parcels = await client.query<{ status: string }>(
      `SELECT status FROM order_fulfilments WHERE business_id = $1 AND id = ANY($2::uuid[]) AND status <> 'cancelled' FOR UPDATE`,
      [p.businessId, p.fulfilmentIds],
    );
    if (parcels.rows.some((r) => !NOT_PACKED.includes(r.status))) {
      throw new OrderEditError(409, 'This order is already packed or on its way. Use a return instead.');
    }
  }
  const lines = p.lines.filter((l) => Number(l.quantity) > 0);
  if (lines.length === 0) throw new OrderEditError(400, 'Choose what to take off the order');

  try {
    const returnId = await createReturn(client, {
      businessId: p.businessId,
      invoiceId: p.invoiceId,
      lines,
      reason: 'not_needed',
      reasonNote: p.note?.trim() || 'Removed from the order before packing',
      initiatedBy: 'merchant',
      userId: p.userId,
    });
    await client.query(`UPDATE order_returns SET removed_before_dispatch = true WHERE id = $1`, [returnId]);
    const received = await receiveReturn(client, {
      businessId: p.businessId,
      returnId,
      userId: p.userId,
      // Nothing left the shop, so everything goes straight back on the shelf.
      lines: null,
      refund: p.refund ?? { method: 'store_credit' },
    });
    return {
      returnId,
      creditNoteNumber: received.creditNoteNumber,
      creditAmount: received.creditAmount,
      refundable: received.refundable,
    };
  } catch (e) {
    if (e instanceof ReturnError) throw new OrderEditError(e.status, e.message);
    throw e;
  }
}
