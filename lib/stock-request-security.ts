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

function linkError(message: string, code: string, statusCode = 400): Error {
  const err: any = new Error(message);
  err.statusCode = statusCode;
  err.code = code;
  return err;
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
      AND deleted_at IS NULL
    LIMIT 1
    `,
    [requesterBusinessId, responderBusinessId]
  );
  if (!row) {
    throw linkError(
      'Supplier is not linked to your business. Only linked businesses can receive quantity requests.',
      'SUPPLIER_NOT_LINKED'
    );
  }
}

/** Buyer has linked this vendor and allowed them to see low stock. */
export async function assertVendorLowStockAccess(
  buyerBusinessId: string,
  vendorBusinessId: string
): Promise<void> {
  const row = await db.queryOne(
    `
    SELECT id FROM suppliers
    WHERE business_id = $1
      AND linked_business_id = $2
      AND allow_low_stock_access = true
      AND deleted_at IS NULL
    LIMIT 1
    `,
    [buyerBusinessId, vendorBusinessId]
  );
  if (!row) {
    throw linkError(
      'This customer has not granted you low-stock access.',
      'LOW_STOCK_ACCESS_REQUIRED',
      403
    );
  }
}

/** Vendor is the default supplier, a past purchase source, or has a threshold on this buyer item. */
export async function assertVendorSuppliesBuyerItem(
  buyerBusinessId: string,
  vendorBusinessId: string,
  itemId: string
): Promise<void> {
  const row = await db.queryOne(
    `
    SELECT 1
    FROM items i
    WHERE i.id = $1
      AND i.business_id = $2
      AND (
        EXISTS (
          SELECT 1 FROM suppliers s2
          WHERE s2.id = i.default_supplier_id
            AND s2.linked_business_id = $3
            AND s2.business_id = $2
            AND s2.deleted_at IS NULL
        )
        OR EXISTS (
          SELECT 1 FROM purchases p
          JOIN purchase_items pi ON p.id = pi.purchase_id
          JOIN suppliers s3 ON p.supplier_id = s3.id
          WHERE s3.linked_business_id = $3
            AND s3.business_id = $2
            AND pi.item_id = i.id
            AND p.business_id = $2
            AND p.status != 'cancelled'
        )
        OR EXISTS (
          SELECT 1 FROM supplier_item_thresholds t
          WHERE t.item_id = i.id
            AND t.customer_business_id = $2
            AND t.supplier_business_id = $3
        )
      )
    `,
    [itemId, buyerBusinessId, vendorBusinessId]
  );
  if (!row) {
    throw linkError(
      'You can only request quantities for items you supply to this customer.',
      'ITEM_NOT_SUPPLIED'
    );
  }
}
