import { NextRequest, NextResponse } from 'next/server';
import * as db from '@/lib/db';
import { requireAuthenticatedTenant } from '@/lib/stock-request-security';
import { logQuantityRequestEvent } from '@/lib/quantity-request-audit';

/**
 * POST /api/stock-requests/[id]/link
 * Body: { purchase_order_id?, sales_order_id?, invoice_id?, purchase_id? }
 * Caller must be requester or responder on the quantity request.
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = requireAuthenticatedTenant(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const requestId = params.id;
    const body = await request.json();
    const { purchase_order_id, sales_order_id, invoice_id, purchase_id } = body;

    if (!purchase_order_id && !sales_order_id && !invoice_id && !purchase_id) {
      return NextResponse.json({ error: 'nothing to link' }, { status: 400 });
    }

    const row = await db.queryOne<{
      id: string;
      requester_business_id: string;
      responder_business_id: string;
    }>(
      `SELECT id, requester_business_id, responder_business_id FROM quantity_requests WHERE id = $1`,
      [requestId]
    );

    if (!row) {
      return NextResponse.json({ error: 'request not found' }, { status: 404 });
    }

    const allowed =
      row.requester_business_id === auth.businessId || row.responder_business_id === auth.businessId;
    if (!allowed) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    const updated = await db.queryOne(
      `
      UPDATE quantity_requests
      SET
        purchase_order_id = COALESCE($1, purchase_order_id),
        sales_order_id = COALESCE($2, sales_order_id),
        invoice_id = COALESCE($3, invoice_id),
        purchase_id = COALESCE($4, purchase_id),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $5
      RETURNING *
      `,
      [
        purchase_order_id || null,
        sales_order_id || null,
        invoice_id || null,
        purchase_id || null,
        requestId,
      ]
    );

    if (!updated) {
      return NextResponse.json({ error: 'request not found' }, { status: 404 });
    }

    await logQuantityRequestEvent({
      quantityRequestId: requestId,
      businessId: auth.businessId,
      actorUserId: auth.userId,
      eventType: 'document_linked',
      payload: {
        purchase_order_id: purchase_order_id || null,
        sales_order_id: sales_order_id || null,
        invoice_id: invoice_id || null,
        purchase_id: purchase_id || null,
      },
    });

    return NextResponse.json({ success: true, request: updated });
  } catch (error: any) {
    console.error('Error linking documents to stock request:', error);
    return NextResponse.json(
      { error: 'Failed to link documents', details: error.message },
      { status: 500 }
    );
  }
}
