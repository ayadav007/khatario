import { NextRequest, NextResponse } from 'next/server';
import * as db from '@/lib/db';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { enforceAccessErrorResponse } from '@/lib/enforce-access';
import { Supplier } from '@/types/database';
import { getUserIdFromRequest, getBusinessIdFromRequest, requireStrictSession } from '@/lib/auth-helpers';
import {
  checkSupplierInput,
  createSupplier,
  SupplierAccessRefused,
  CREATE_FAILED,
  DUPLICATE_GSTIN,
  DUPLICATE_SUPPLIER,
  INVALID_PAN,
  NAME_REQUIRED,
  SELF_LINK,
  type CreateSupplierInput,
} from '@/lib/suppliers/create-supplier';

export const dynamic = 'force-dynamic';

/**
 * GET /api/suppliers
 * Fetch all suppliers for a business
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request); // REQUIRED for authorization
    const search = searchParams.get('search') || '';
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = (page - 1) * limit;
    const updatedAfter = searchParams.get('updated_after');

    if (!businessId) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    if (!userId) {
      return NextResponse.json(
        { error: 'user_id is required for authorization' },
        { status: 400 }
      );
    }

    // AUTHORIZATION: Check read permission (suppliers are part of purchases module)
    try {
      await authorize(userId, 'purchases', 'read', { businessId });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    // NOTE: Suppliers are business-level entities (not branch-specific)
    // They should be visible across all branches of the business
    // The query filters only by business_id and is_active - no branch filtering
    // This ensures all suppliers for a business are visible regardless of which branch the user is in

    let sql = `
      SELECT 
        id, business_id, name, phone, email, address,
        city, state, state_code, pincode, gstin,
        opening_balance, opening_balance_type, COALESCE(current_balance, 0) AS current_balance,
        is_active, created_at, updated_at,
        linked_business_id, approval_status, allow_low_stock_access
      FROM suppliers
      -- Soft delete: exclude records where deleted_at is set
      WHERE business_id = $1 AND deleted_at IS NULL AND is_active = true
    `;
    const params: any[] = [businessId];

    // Name, phone, or address. The payment screen searches the same way.
    if (search) {
      sql += ` AND (
        name ILIKE $${params.length + 1}
        OR phone ILIKE $${params.length + 1}
        OR email ILIKE $${params.length + 1}
        OR address ILIKE $${params.length + 1}
        OR city ILIKE $${params.length + 1}
        OR state ILIKE $${params.length + 1}
        OR pincode ILIKE $${params.length + 1}
      )`;
      params.push(`%${search}%`);
    }

    if (updatedAfter) {
      sql += ` AND suppliers.updated_at >= $${params.length + 1}::timestamptz`;
      params.push(updatedAfter);
    }

    // Get total count for pagination
    const countParams = params.slice(0, params.length);
    const countSql = sql.replace(/SELECT[\s\S]*?FROM/, 'SELECT COUNT(*) as total FROM');
    const countResult = await db.queryOne<{ total: number }>(countSql, countParams);
    const total = countResult?.total || 0;

    sql += ` ORDER BY name ASC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const suppliers = await db.queryRows<Supplier>(sql, params);
    

    return NextResponse.json({ 
      suppliers,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error: any) {
    console.error('Error fetching suppliers:', error);
    return NextResponse.json(
      { error: 'Failed to fetch suppliers', details: error.message },
      { status: 500 }
    );
  }
}

/**
 * POST /api/suppliers
 * Create a new supplier (optionally link to a business account)
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const session = await requireStrictSession(request);
    if (!session.ok) return session.response;
    const business_id = session.businessId;
    const createdByUserId = session.userId;
    const input = body as CreateSupplierInput;

    // PAN, name and GSTIN are checked before authorize, as they always have been.
    const checked = checkSupplierInput(input);
    if (!checked.ok) {
      if (checked.code === INVALID_PAN || checked.code === NAME_REQUIRED) {
        return NextResponse.json({ error: checked.error }, { status: checked.status });
      }
      return NextResponse.json({ error: checked.error, code: checked.code }, { status: checked.status });
    }

    // AUTHORIZATION: supplier create (not purchase create — avoids purchase-only PBAC side effects)
    try {
      await authorize(createdByUserId, 'suppliers', 'create', { businessId: business_id });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    const { getClientIP, getUserAgent } = await import('@/lib/activity-logger');
    let result: Awaited<ReturnType<typeof createSupplier>>;
    try {
      result = await createSupplier(
        { businessId: business_id, userId: createdByUserId },
        input,
        { ip: getClientIP(request), userAgent: getUserAgent(request) }
      );
    } catch (e) {
      if (!(e instanceof SupplierAccessRefused)) throw e;
      const res = enforceAccessErrorResponse(e.reason);
      if (res) return res;
      throw e.reason;
    }

    if (!result.ok) {
      if (result.code === DUPLICATE_GSTIN && result.existing) {
        return NextResponse.json(
          { supplier: result.existing, deduplicated: true, message: result.error },
          { status: 200 }
        );
      }
      if (result.code === DUPLICATE_SUPPLIER) {
        console.error('[SupplierAPI] ERROR creating supplier:', result.details);
        return NextResponse.json(
          { error: result.error, code: DUPLICATE_SUPPLIER, details: result.details },
          { status: 409 }
        );
      }
      if (result.code === CREATE_FAILED || result.code === SELF_LINK) {
        return NextResponse.json({ error: result.error }, { status: result.status });
      }
      return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
    }

    return NextResponse.json({ supplier: result.record }, { status: 201 });
  } catch (error: any) {
    console.error('[SupplierAPI] ERROR creating supplier:', error?.message);
    console.error('[SupplierAPI] Stack:', error?.stack);

    if (error?.code === '23505') {
      return NextResponse.json(
        {
          error: 'A supplier with this GSTIN or name already exists for your business.',
          code: 'DUPLICATE_SUPPLIER',
          details: error?.message,
        },
        { status: 409 }
      );
    }

    const detail = error?.message || 'Unknown error';
    return NextResponse.json(
      {
        error: `Failed to create supplier: ${detail}`,
        details: detail,
      },
      { status: 500 }
    );
  }
}

