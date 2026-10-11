import { NextRequest, NextResponse } from 'next/server';
import * as db from '@/lib/db';
import { requireAuthenticatedTenant } from '@/lib/stock-request-security';
import { partiesFromItemOwner } from '@/lib/quantity-request-parties';
import { logQuantityRequestEvent } from '@/lib/quantity-request-audit';

export const dynamic = 'force-dynamic';

/**
 * PATCH /api/stock-requests/[id]
 * Responder maps their catalog item (required before PO/purchase from request).
 * Body: { responder_item_id: string }
 */
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = requireAuthenticatedTenant(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json();
    const responderItemId = body.responder_item_id != null ? String(body.responder_item_id).trim() : '';
    if (!responderItemId) {
      return NextResponse.json({ error: 'responder_item_id is required' }, { status: 400 });
    }

    const existing = await db.queryOne<{
      id: string;
      requester_business_id: string;
      responder_business_id: string;
      item_id: string;
      item_business_id: string;
    }>(
      `SELECT qr.id, qr.requester_business_id, qr.responder_business_id, qr.item_id, i.business_id AS item_business_id
       FROM quantity_requests qr
       JOIN items i ON i.id = qr.item_id
       WHERE qr.id = $1`,
      [params.id]
    );

    if (!existing) {
      return NextResponse.json({ error: 'request not found' }, { status: 404 });
    }

    const parties = partiesFromItemOwner(
      existing.requester_business_id,
      existing.responder_business_id,
      existing.item_business_id,
      existing.item_id
    );
    if (!parties || parties.vendorBusinessId !== auth.businessId) {
      return NextResponse.json(
        { error: 'Only the vendor can map their catalog item on this request' },
        { status: 403 }
      );
    }

    const itemOk = await db.queryOne(
      `SELECT 1 FROM items WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL`,
      [responderItemId, parties.vendorBusinessId]
    );
    if (!itemOk) {
      return NextResponse.json(
        {
          error: 'Selected item must exist in your catalog.',
          code: 'ITEM_BUSINESS_MISMATCH',
        },
        { status: 400 }
      );
    }

    const updated = await db.queryOne(
      `
      UPDATE quantity_requests
      SET responder_item_id = $1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
      RETURNING *
      `,
      [responderItemId, params.id]
    );

    await logQuantityRequestEvent({
      quantityRequestId: params.id,
      businessId: auth.businessId,
      actorUserId: auth.userId,
      eventType: 'mapping_updated',
      payload: { responder_item_id: responderItemId },
    });

    return NextResponse.json({ success: true, request: updated });
  } catch (error: any) {
    console.error('Error patching stock request:', error);
    return NextResponse.json(
      { error: 'Failed to update request', details: error.message },
      { status: 500 }
    );
  }
}
