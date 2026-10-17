import { NextRequest, NextResponse } from 'next/server';
import * as db from '@/lib/db';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { requireAuthenticatedTenant } from '@/lib/stock-request-security';
import { ensureVendorCustomerLink } from '@/lib/supplier-hub-links';

export const dynamic = 'force-dynamic';

/**
 * POST /api/suppliers/hub/linked-customer
 * Body: { buyer_business_id }
 * For the session business as supplier: returns its customer record for a linked buyer,
 * linking or creating it if needed. Requires the buyer's approved link to this business.
 */
export async function POST(request: NextRequest) {
  const auth = requireAuthenticatedTenant(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json().catch(() => ({}));
    const buyerBusinessId = String(body.buyer_business_id || '');
    if (!buyerBusinessId) {
      return NextResponse.json({ error: 'buyer_business_id is required' }, { status: 400 });
    }

    try {
      await authorize(auth.userId, 'customers', 'read', { businessId: auth.businessId });
    } catch (error) {
      if (error instanceof AuthorizationError) return error.toNextResponse();
      throw error;
    }

    const link = await db.queryOne(
      `SELECT id FROM suppliers
        WHERE business_id = $1 AND linked_business_id = $2
          AND approval_status = 'approved' AND deleted_at IS NULL
        LIMIT 1`,
      [buyerBusinessId, auth.businessId]
    );
    if (!link) {
      return NextResponse.json(
        { error: 'This business is not a connected buyer of yours', code: 'NOT_LINKED' },
        { status: 403 }
      );
    }

    const customerId = await ensureVendorCustomerLink(auth.businessId, buyerBusinessId);
    return NextResponse.json({ customer_id: customerId });
  } catch (error: any) {
    console.error('hub linked-customer POST', error);
    return NextResponse.json({ error: 'Failed to find the customer record' }, { status: 500 });
  }
}
