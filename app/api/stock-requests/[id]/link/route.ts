import { NextRequest, NextResponse } from 'next/server';
import * as db from '@/lib/db';
import { requireAuthenticatedTenant } from '@/lib/stock-request-security';
import { partiesFromItemOwner } from '@/lib/quantity-request-parties';
import { logQuantityRequestEvent } from '@/lib/quantity-request-audit';

export const dynamic = 'force-dynamic';

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
      item_id: string;
      item_business_id: string;
    }>(
      `SELECT qr.id, qr.requester_business_id, qr.responder_business_id, qr.item_id,
              i.business_id AS item_business_id
       FROM quantity_requests qr
       JOIN items i ON i.id = qr.item_id
       WHERE qr.id = $1`,
      [requestId]
    );

    if (!row) {
      return NextResponse.json({ error: 'request not found' }, { status: 404 });
    }

    const parties = partiesFromItemOwner(
      row.requester_business_id,
      row.responder_business_id,
      row.item_business_id,
      row.item_id
    );
    if (!parties) {
      return NextResponse.json({ error: 'request is not tied to a buyer item' }, { status: 400 });
    }

    const allowed =
      parties.buyerBusinessId === auth.businessId || parties.vendorBusinessId === auth.businessId;
    if (!allowed) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    async function owned(table: string, id: string | null, businessId: string) {
      if (!id) return true;
      const found = await db.queryOne(
        `SELECT id FROM ${table} WHERE id = $1 AND business_id = $2`,
        [id, businessId]
      );
      return !!found;
    }

    if (!(await owned('purchase_orders', purchase_order_id || null, parties.buyerBusinessId))) {
      return NextResponse.json({ error: 'Purchase order was not found on the buyer’s books' }, { status: 400 });
    }
    if (!(await owned('purchases', purchase_id || null, parties.buyerBusinessId))) {
      return NextResponse.json({ error: 'Purchase was not found on the buyer’s books' }, { status: 400 });
    }
    if (!(await owned('sales_orders', sales_order_id || null, parties.vendorBusinessId))) {
      return NextResponse.json({ error: 'Sales order was not found on the vendor’s books' }, { status: 400 });
    }
    if (!(await owned('invoices', invoice_id || null, parties.vendorBusinessId))) {
      return NextResponse.json({ error: 'Invoice was not found on the vendor’s books' }, { status: 400 });
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
