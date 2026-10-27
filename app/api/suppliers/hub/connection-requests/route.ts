import { NextRequest, NextResponse } from 'next/server';
import * as db from '@/lib/db';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { requireAuthenticatedTenant } from '@/lib/stock-request-security';
import { openConnectionRequest } from '@/lib/supplier-hub-links';
import type { SupplierConnectionRequest } from '@/types/database';

export const dynamic = 'force-dynamic';

/**
 * GET /api/suppliers/hub/connection-requests — incoming + outgoing for current business
 * POST — buyer creates request (body: supplier_business_id, message?, share_low_stock?)
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
    const shareLowStock = body.share_low_stock === true;

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

    const { request: row, existing } = await openConnectionRequest({
      buyerBusinessId,
      supplierBusinessId,
      createdByUserId,
      message,
      shareLowStock,
    });
    if (existing) {
      return NextResponse.json({ request: row, existing: true });
    }

    return NextResponse.json({ request: row }, { status: 201 });
  } catch (e: any) {
    console.error('hub connection-requests POST', e);
    return NextResponse.json({ error: e.message || 'Failed' }, { status: 500 });
  }
}
