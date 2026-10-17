import { NextRequest, NextResponse } from 'next/server';
import * as db from '@/lib/db';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { requireAuthenticatedTenant } from '@/lib/stock-request-security';
import type { SupplierConnectionRequest } from '@/types/database';

export const dynamic = 'force-dynamic';

/**
 * GET /api/suppliers/hub/connection-requests — incoming + outgoing for current business
 * POST — buyer creates request (body: supplier_business_id, message?)
 * Business and user come from the session only.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = requireAuthenticatedTenant(request);
    if (auth instanceof NextResponse) return auth;
    const { businessId, userId } = auth;
    try {
      await authorize(userId, 'purchases', 'read', { businessId });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    const incoming = await db.queryRows<
      SupplierConnectionRequest & { counterparty_name: string }
    >(
      `
      SELECT r.*, b.name AS counterparty_name
      FROM supplier_connection_requests r
      INNER JOIN businesses b ON b.id = r.buyer_business_id
      WHERE r.supplier_business_id = $1
      ORDER BY r.created_at DESC
      LIMIT 100
      `,
      [businessId]
    );

    const outgoing = await db.queryRows<
      SupplierConnectionRequest & { counterparty_name: string }
    >(
      `
      SELECT r.*, b.name AS counterparty_name
      FROM supplier_connection_requests r
      INNER JOIN businesses b ON b.id = r.supplier_business_id
      WHERE r.buyer_business_id = $1
      ORDER BY r.created_at DESC
      LIMIT 100
      `,
      [businessId]
    );

    return NextResponse.json({ incoming, outgoing });
  } catch (e: any) {
    console.error('hub connection-requests GET', e);
    return NextResponse.json({ error: e.message || 'Failed' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = requireAuthenticatedTenant(request);
    if (auth instanceof NextResponse) return auth;
    const { businessId: buyerBusinessId, userId: createdByUserId } = auth;
    const body = await request.json();
    const { supplier_business_id: supplierBusinessId, message } = body;

    if (!supplierBusinessId) {
      return NextResponse.json({ error: 'supplier_business_id is required' }, { status: 400 });
    }
    if (buyerBusinessId === supplierBusinessId) {
      return NextResponse.json({ error: 'Cannot connect a business to itself' }, { status: 400 });
    }

    try {
      await authorize(createdByUserId, 'purchases', 'create', { businessId: buyerBusinessId });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    const disc = await db.queryOne<{ visibility: string }>(
      `SELECT visibility FROM business_discovery WHERE business_id = $1`,
      [supplierBusinessId]
    );
    if (!disc || disc.visibility === 'hidden') {
      return NextResponse.json(
        { error: 'This business is not open to connection requests' },
        { status: 400 }
      );
    }

    const alreadyLinked = await db.queryOne(
      `SELECT id FROM suppliers
       WHERE business_id = $1 AND linked_business_id = $2
         AND approval_status = 'approved' AND is_active = true`,
      [buyerBusinessId, supplierBusinessId]
    );
    if (alreadyLinked) {
      return NextResponse.json(
        { error: 'Already connected with this supplier' },
        { status: 409 }
      );
    }

    const pending = await db.queryOne<SupplierConnectionRequest>(
      `SELECT * FROM supplier_connection_requests
       WHERE buyer_business_id = $1 AND supplier_business_id = $2 AND status = 'pending'`,
      [buyerBusinessId, supplierBusinessId]
    );
    if (pending) {
      return NextResponse.json({ request: pending, existing: true });
    }

    const row = await db.queryOne<SupplierConnectionRequest>(
      `
      INSERT INTO supplier_connection_requests (
        buyer_business_id, supplier_business_id, status, message, created_by_user_id
      )
      VALUES ($1, $2, 'pending', $3, $4)
      RETURNING *
      `,
      [buyerBusinessId, supplierBusinessId, message || null, createdByUserId]
    );

    const buyerBiz = await db.queryOne<{ name: string }>(
      `SELECT name FROM businesses WHERE id = $1`,
      [buyerBusinessId]
    );

    await db.query(
      `
      INSERT INTO notifications (
        business_id, type, title, message, reference_type, reference_id, created_at
      )
      VALUES ($1, 'hub_connection_request', $2, $3, 'supplier_connection_request', $4, CURRENT_TIMESTAMP)
      `,
      [
        supplierBusinessId,
        'New supplier connection request',
        `${buyerBiz?.name || 'A business'} wants to connect as a buyer. Open Suppliers Hub requests to accept or decline.`,
        row!.id,
      ]
    );

    return NextResponse.json({ request: row }, { status: 201 });
  } catch (e: any) {
    console.error('hub connection-requests POST', e);
    return NextResponse.json({ error: e.message || 'Failed' }, { status: 500 });
  }
}
