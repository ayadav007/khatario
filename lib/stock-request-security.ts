import { NextRequest, NextResponse } from 'next/server';
import { getBusinessIdFromRequest, getUserIdFromRequest } from '@/lib/auth-helpers';
import * as db from '@/lib/db';

export type AuthenticatedTenant = { businessId: string; userId: string };

/**
 * Require JWT/middleware-injected user and business. Does not trust body/query alone.
 */
export function requireAuthenticatedTenant(request: NextRequest): AuthenticatedTenant | NextResponse {
  const businessId = getBusinessIdFromRequest(request);
  const userId = getUserIdFromRequest(request);

  if (!businessId || !userId) {
    return NextResponse.json(
      { error: 'Authentication required', code: 'UNAUTHENTICATED' },
      { status: 401 }
    );
  }

  const headerBiz = request.headers.get('x-authenticated-business-id');
  const headerUser = request.headers.get('x-authenticated-user-id');
  if (headerBiz && headerBiz !== businessId) {
    return NextResponse.json(
      { error: 'Business context mismatch', code: 'TENANT_MISMATCH' },
      { status: 403 }
    );
  }
  if (headerUser && headerUser !== userId) {
    return NextResponse.json(
      { error: 'User context mismatch', code: 'USER_MISMATCH' },
      { status: 403 }
    );
  }

  return { businessId, userId };
}

/** True if responder_business_id is a linked supplier of requester_business_id. */
export async function assertLinkedSupplier(
  requesterBusinessId: string,
  responderBusinessId: string
): Promise<void> {
  const row = await db.queryOne(
    `
    SELECT id FROM suppliers
    WHERE business_id = $1
      AND linked_business_id = $2
    LIMIT 1
    `,
    [requesterBusinessId, responderBusinessId]
  );
  if (!row) {
    const err: any = new Error(
      'Supplier is not linked to your business. Only linked businesses can receive quantity requests.'
    );
    err.statusCode = 400;
    err.code = 'SUPPLIER_NOT_LINKED';
    throw err;
  }
}
