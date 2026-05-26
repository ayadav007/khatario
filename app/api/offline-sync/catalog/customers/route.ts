import { NextRequest, NextResponse } from 'next/server';
import { queryRows, queryOne } from '@/lib/db';
import { Customer } from '@/types/database';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import { isPrimaryAdminForBusiness } from '@/lib/enforce-access';

/** Paginated customer export for offline catalog sync (same filters as GET /api/customers). */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = Math.min(parseInt(searchParams.get('limit') || '500', 10), 500);
    const offset = (page - 1) * limit;
    const updatedAfter = searchParams.get('updated_after');

    if (!businessId) {
      return NextResponse.json({ error: 'business_id is required' }, { status: 400 });
    }
    if (!userId) {
      return NextResponse.json(
        { error: 'user_id is required for authorization' },
        { status: 400 }
      );
    }

    try {
      await authorize(userId, 'customers', 'read');
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    const params: unknown[] = [businessId];
    let sql = `
      SELECT * FROM customers
      WHERE business_id = $1 AND is_active = true AND deleted_at IS NULL
    `;

    const isAdmin = await isPrimaryAdminForBusiness(userId, businessId);
    if (!isAdmin) {
      const { getUserAccessibleBranchIds } = await import('@/lib/branch-access');
      const branchIds = await getUserAccessibleBranchIds(userId);
      if (branchIds.length === 0) {
        sql += ` AND 1=0`;
      } else {
        const b = `$${params.length + 1}::uuid[]`;
        sql += ` AND (
          EXISTS (
            SELECT 1 FROM invoices i
            WHERE i.customer_id = customers.id
              AND i.deleted_at IS NULL
              AND i.branch_id = ANY(${b})
          )
          OR EXISTS (
            SELECT 1 FROM credit_notes cn
            WHERE cn.customer_id = customers.id
              AND cn.branch_id IS NOT NULL
              AND cn.branch_id = ANY(${b})
          )
          OR EXISTS (
            SELECT 1 FROM debit_notes dn
            WHERE dn.customer_id = customers.id
              AND dn.branch_id IS NOT NULL
              AND dn.branch_id = ANY(${b})
          )
        )`;
        params.push(branchIds);
      }
    }

    if (updatedAfter) {
      sql += ` AND customers.updated_at >= $${params.length + 1}::timestamptz`;
      params.push(updatedAfter);
    }

    const countParams = params.slice();
    const countSql = sql.replace(/SELECT \*/, 'SELECT COUNT(*)::integer AS total');
    const countResult = await queryOne<{ total: number }>(countSql, countParams);
    const total = countResult?.total ?? 0;

    sql += ` ORDER BY name ASC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const customers = await queryRows<Customer>(sql, params);

    return NextResponse.json({
      customers,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Catalog customers sync failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
