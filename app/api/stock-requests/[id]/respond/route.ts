import { NextRequest, NextResponse } from 'next/server';
import * as db from '@/lib/db';
import { requireAuthenticatedTenant } from '@/lib/stock-request-security';
import { logQuantityRequestEvent } from '@/lib/quantity-request-audit';

/**
 * POST /api/stock-requests/[id]/respond
 * Body: { status: 'confirmed'|'partial'|'declined'|'backorder', confirmed_qty?: number, notes?: string }
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = requireAuthenticatedTenant(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const requestId = params.id;
    const body = await request.json();
    const status = (body.status || '').toLowerCase();
    const confirmedQty = body.confirmed_qty;
    const notes = body.notes;

    if (!['confirmed', 'partial', 'declined', 'backorder'].includes(status)) {
      return NextResponse.json({ error: 'invalid status' }, { status: 400 });
    }

    if (status !== 'declined' && (confirmedQty === undefined || confirmedQty === null || confirmedQty < 0)) {
      return NextResponse.json({ error: 'confirmed_qty is required for this status' }, { status: 400 });
    }

    const existing = await db.queryOne<{
      id: string;
      requester_business_id: string;
      responder_business_id: string;
      requested_qty: string | number;
      status: string;
    }>(`SELECT * FROM quantity_requests WHERE id = $1`, [requestId]);

    if (!existing) {
      return NextResponse.json({ error: 'request not found' }, { status: 404 });
    }

    if (existing.responder_business_id !== auth.businessId) {
      return NextResponse.json({ error: 'only the supplier can respond to this request' }, { status: 403 });
    }

    if (existing.status !== 'pending') {
      return NextResponse.json(
        { error: 'request is no longer pending', code: 'INVALID_STATE', current_status: existing.status },
        { status: 409 }
      );
    }

    const reqQty = Number(existing.requested_qty);
    const cQty = confirmedQty != null ? Number(confirmedQty) : NaN;

    if (status === 'confirmed') {
      if (Math.abs(cQty - reqQty) > 1e-6) {
        return NextResponse.json(
          {
            error: 'For status confirmed, confirmed_qty must equal requested_qty',
            code: 'QTY_MISMATCH',
          },
          { status: 400 }
        );
      }
    }

    if (status === 'partial') {
      if (!(cQty > 0 && cQty < reqQty)) {
        return NextResponse.json(
          {
            error: 'For partial, confirmed_qty must be greater than 0 and less than requested_qty',
            code: 'QTY_PARTIAL_INVALID',
          },
          { status: 400 }
        );
      }
    }

    if (status === 'backorder' && (cQty <= 0 || cQty > reqQty + 1e-6)) {
      return NextResponse.json(
        {
          error: 'For backorder, confirmed_qty must be positive and must not exceed requested_qty',
          code: 'QTY_BACKORDER_INVALID',
        },
        { status: 400 }
      );
    }

    let updated;
    if (status === 'declined') {
      updated = await db.queryOne(
        `
        UPDATE quantity_requests
        SET
          status = $1,
          confirmed_qty = NULL,
          notes = COALESCE($2, notes),
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $3
        RETURNING *
        `,
        [status, notes || null, requestId]
      );
    } else {
      updated = await db.queryOne(
        `
        UPDATE quantity_requests
        SET
          status = $1,
          confirmed_qty = $2::DECIMAL,
          notes = COALESCE($3, notes),
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $4
        RETURNING *
        `,
        [status, confirmedQty, notes || null, requestId]
      );
    }

    if (!updated) {
      return NextResponse.json({ error: 'request not found' }, { status: 404 });
    }

    try {
      const responder = await db.queryOne(`SELECT name FROM businesses WHERE id = $1`, [
        existing.responder_business_id,
      ]);
      const requesterBizId = existing.requester_business_id;
      const responderName = responder?.name || 'Supplier';

      await db.query(
        `
        INSERT INTO notifications (
          business_id, type, title, message, reference_type, reference_id, created_at
        )
        VALUES ($1, 'quantity_response', $2, $3, 'quantity_request', $4, $5)
        `,
        [
          requesterBizId,
          'Request Responded',
          `${responderName} responded with status ${status}${confirmedQty != null ? `, qty ${confirmedQty}` : ''}.`,
          requestId,
          new Date(),
        ]
      );
    } catch (notifError: any) {
      console.error('Error creating notification (non-fatal):', notifError.message);
      if (notifError.message?.includes('chk_notification_type')) {
        console.error('Notification type constraint violation. Please run migration 101_add_quantity_request_notification_type.sql');
      }
    }

    await logQuantityRequestEvent({
      quantityRequestId: requestId,
      businessId: auth.businessId,
      actorUserId: auth.userId,
      eventType: 'responded',
      payload: {
        status,
        confirmed_qty: confirmedQty != null ? Number(confirmedQty) : null,
        notes: notes || null,
      },
    });

    return NextResponse.json({ success: true, request: updated });
  } catch (error: any) {
    console.error('Error responding to stock request:', error);
    return NextResponse.json(
      { error: 'Failed to respond', details: error.message },
      { status: 500 }
    );
  }
}
