import { NextRequest, NextResponse } from 'next/server';
import * as db from '@/lib/db';
import { requireAuthenticatedTenant, assertLinkedSupplier } from '@/lib/stock-request-security';
import { logQuantityRequestEvent } from '@/lib/quantity-request-audit';

/**
 * GET /api/stock-requests
 * Tenant = authenticated business only (query business_id ignored for security).
 * Query: role=all|requester|responder
 */
export async function GET(request: NextRequest) {
  const auth = requireAuthenticatedTenant(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const { searchParams } = new URL(request.url);
    const role = (searchParams.get('role') || 'all').toLowerCase();
    const businessId = auth.businessId;

    const where: string[] = [];
    const params: any[] = [];

    if (role === 'requester') {
      where.push('qr.requester_business_id = $1');
      params.push(businessId);
    } else if (role === 'responder') {
      where.push('qr.responder_business_id = $1');
      params.push(businessId);
    } else {
      where.push('(qr.requester_business_id = $1 OR qr.responder_business_id = $1)');
      params.push(businessId);
    }

    const results = await db.queryRows(
      `
      SELECT
        qr.*,
        req.name as requester_name,
        res.name as responder_name,
        i.name as item_name,
        i.code as item_code,
        ri.name as responder_item_name,
        ri.code as responder_item_code,
        po.order_number as purchase_order_number,
        so.order_number as sales_order_number,
        inv.invoice_number,
        inv.id as invoice_id
      FROM quantity_requests qr
      LEFT JOIN businesses req ON req.id = qr.requester_business_id
      LEFT JOIN businesses res ON res.id = qr.responder_business_id
      LEFT JOIN items i ON i.id = qr.item_id
      LEFT JOIN items ri ON ri.id = qr.responder_item_id
      LEFT JOIN purchase_orders po ON po.id = qr.purchase_order_id
      LEFT JOIN sales_orders so ON so.id = qr.sales_order_id
      LEFT JOIN invoices inv ON inv.id = qr.invoice_id
      WHERE ${where.join(' AND ')}
      ORDER BY qr.created_at DESC
      `,
      params
    );

    return NextResponse.json({ requests: results });
  } catch (error: any) {
    console.error('Error fetching stock requests:', error);
    return NextResponse.json(
      { error: 'Failed to fetch stock requests', details: error.message },
      { status: 500 }
    );
  }
}

/**
 * POST /api/stock-requests
 * Body: { requests: [...] } — requester_business_id must equal authenticated tenant.
 */
export async function POST(request: NextRequest) {
  const auth = requireAuthenticatedTenant(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json();
    const requests = Array.isArray(body.requests) ? body.requests : [];

    if (requests.length === 0) {
      return NextResponse.json({ error: 'requests array is required' }, { status: 400 });
    }

    const inserted: any[] = [];
    const businessCache = new Map<string, any>();

    async function getBusiness(businessId: string) {
      if (businessCache.has(businessId)) return businessCache.get(businessId);
      const row = await db.queryOne(`SELECT id, name FROM businesses WHERE id = $1`, [businessId]);
      businessCache.set(businessId, row);
      return row;
    }

    for (const req of requests) {
      const {
        requester_business_id,
        responder_business_id,
        item_id,
        requested_qty,
        need_by_date,
        notes,
        low_stock_alert_id,
        parent_request_id,
      } = req;

      if (!requester_business_id || !responder_business_id || !item_id || requested_qty === undefined) {
        return NextResponse.json(
          { error: 'requester_business_id, responder_business_id, item_id, requested_qty are required' },
          { status: 400 }
        );
      }

      if (requester_business_id !== auth.businessId) {
        return NextResponse.json(
          { error: 'You can only create requests for your own business', code: 'FORBIDDEN_REQUESTER' },
          { status: 403 }
        );
      }

      const itemOwner = await db.queryOne(
        `SELECT business_id FROM items WHERE id = $1`,
        [item_id]
      );
      if (!itemOwner || String(itemOwner.business_id) !== String(requester_business_id)) {
        return NextResponse.json(
          { error: 'item_id must belong to the requester business catalog', code: 'ITEM_NOT_REQUESTER' },
          { status: 400 }
        );
      }

      try {
        await assertLinkedSupplier(requester_business_id, responder_business_id);
      } catch (e: any) {
        const status = e.statusCode || 400;
        return NextResponse.json({ error: e.message, code: e.code || 'SUPPLIER_NOT_LINKED' }, { status });
      }

      const row = await db.queryOne(
        `
        INSERT INTO quantity_requests (
          requester_business_id,
          responder_business_id,
          item_id,
          requested_qty,
          need_by_date,
          notes,
          low_stock_alert_id,
          parent_request_id,
          status
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending')
        RETURNING *
        `,
        [
          requester_business_id,
          responder_business_id,
          item_id,
          requested_qty,
          need_by_date || null,
          notes || null,
          low_stock_alert_id || null,
          parent_request_id || null,
        ]
      );

      if (row) inserted.push(row);

      if (row) {
        const requesterBiz = await getBusiness(requester_business_id);
        const requesterName = requesterBiz?.name || 'A business';

        await db.query(
          `
          INSERT INTO notifications (
            business_id, type, title, message, reference_type, reference_id, created_at
          )
          VALUES ($1, 'quantity_request', $2, $3, 'quantity_request', $4, $5)
          `,
          [
            responder_business_id,
            'New Quantity Request',
            `${requesterName} requested quantity for item ${item_id}.`,
            row.id,
            new Date(),
          ]
        );

        await logQuantityRequestEvent({
          quantityRequestId: row.id,
          businessId: requester_business_id,
          actorUserId: auth.userId,
          eventType: 'created',
          payload: {
            item_id,
            requested_qty,
            responder_business_id,
            need_by_date: need_by_date || null,
          },
        });
      }
    }

    return NextResponse.json({ success: true, created: inserted });
  } catch (error: any) {
    console.error('Error creating stock requests:', error);
    return NextResponse.json(
      { error: 'Failed to create stock requests', details: error.message },
      { status: 500 }
    );
  }
}
