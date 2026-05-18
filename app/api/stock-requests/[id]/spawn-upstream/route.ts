import { NextRequest, NextResponse } from 'next/server';
import * as db from '@/lib/db';
import { requireAuthenticatedTenant, assertLinkedSupplier } from '@/lib/stock-request-security';
import { logQuantityRequestEvent } from '@/lib/quantity-request-audit';

/**
 * POST /api/stock-requests/[id]/spawn-upstream
 * Body: { upstream_business_id, requested_qty, need_by_date?, notes?, item_id? }
 * Caller must be current responder; upstream must be linked supplier of current responder.
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = requireAuthenticatedTenant(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const requestId = params.id;
    const body = await request.json();
    const { upstream_business_id, requested_qty, need_by_date, notes, item_id } = body;

    if (!upstream_business_id || requested_qty === undefined || requested_qty === null) {
      return NextResponse.json({ error: 'upstream_business_id and requested_qty are required' }, { status: 400 });
    }

    const existing = await db.queryOne<{
      id: string;
      responder_business_id: string;
      item_id: string;
      responder_item_id: string | null;
    }>(
      `SELECT id, responder_business_id, item_id, responder_item_id FROM quantity_requests WHERE id = $1`,
      [requestId]
    );

    if (!existing) {
      return NextResponse.json({ error: 'request not found' }, { status: 404 });
    }

    if (existing.responder_business_id !== auth.businessId) {
      return NextResponse.json({ error: 'only the current supplier can spawn an upstream request' }, { status: 403 });
    }

    const newRequester = existing.responder_business_id;
    const newResponder = upstream_business_id;
    const newItemId = (item_id && String(item_id).trim()) || existing.responder_item_id || null;
    if (!newItemId) {
      return NextResponse.json(
        {
          error:
            'Provide item_id (your catalog SKU) on this request, or map your catalog item on the parent request first (responder_item_id).',
          code: 'ITEM_REQUIRED_FOR_UPSTREAM',
        },
        { status: 400 }
      );
    }

    try {
      await assertLinkedSupplier(newRequester, newResponder);
    } catch (e: any) {
      const status = e.statusCode || 400;
      return NextResponse.json({ error: e.message, code: e.code || 'SUPPLIER_NOT_LINKED' }, { status });
    }

    const itemOwner = await db.queryOne(`SELECT business_id FROM items WHERE id = $1`, [newItemId]);
    if (!itemOwner || String(itemOwner.business_id) !== String(newRequester)) {
      return NextResponse.json(
        { error: 'item_id must belong to the requesting (your) business catalog', code: 'ITEM_NOT_REQUESTER' },
        { status: 400 }
      );
    }

    const created = await db.queryOne(
      `
      INSERT INTO quantity_requests (
        requester_business_id,
        responder_business_id,
        item_id,
        requested_qty,
        need_by_date,
        notes,
        parent_request_id,
        status
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,'pending')
      RETURNING *
      `,
      [
        newRequester,
        newResponder,
        newItemId,
        requested_qty,
        need_by_date || null,
        notes || null,
        requestId,
      ]
    );

    const requesterBiz = await db.queryOne(`SELECT name FROM businesses WHERE id = $1`, [newRequester]);
    const requesterName = requesterBiz?.name || 'A business';
    await db.query(
      `
      INSERT INTO notifications (
        business_id, type, title, message, reference_type, reference_id, created_at
      )
      VALUES ($1, 'quantity_request', $2, $3, 'quantity_request', $4, $5)
      `,
      [
        newResponder,
        'New Quantity Request',
        `${requesterName} forwarded a request for item ${newItemId}.`,
        created?.id,
        new Date(),
      ]
    );

    await logQuantityRequestEvent({
      quantityRequestId: requestId,
      businessId: auth.businessId,
      actorUserId: auth.userId,
      eventType: 'spawn_upstream',
      payload: {
        child_request_id: created?.id,
        upstream_business_id: newResponder,
        item_id: newItemId,
        requested_qty,
      },
    });

    return NextResponse.json({ success: true, request: created });
  } catch (error: any) {
    console.error('Error spawning upstream request:', error);
    return NextResponse.json(
      { error: 'Failed to spawn upstream request', details: error.message },
      { status: 500 }
    );
  }
}
