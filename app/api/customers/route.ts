import { NextRequest, NextResponse } from 'next/server';
import { query, queryRows, queryOne } from '@/lib/db';
import { Customer } from '@/types/database';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { requireStrictSession } from '@/lib/auth-helpers';
import {
  enforceAccessErrorResponse,
  isPrimaryAdminForBusiness,
} from '@/lib/enforce-access';
import {
  requirePlatformModule,
  platformModuleErrorResponse,
} from '@/lib/security/require-platform-module';
import { receivableAccountFilter } from '@/lib/accounting/receivable-accounts';
import { hasCustomerReceivableAccounts } from '@/lib/accounting/receivable-accounts-schema';
import { parseReceivableAccountId, receivableAccountErrorResponse } from '@/lib/customers/receivable-account-request';
import {
  createCustomer,
  CustomerAccessRefused,
  CREATE_FAILED,
  type CreateCustomerInput,
} from '@/lib/customers/create-customer';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const session = await requireStrictSession(request);
    if (!session.ok) return session.response;
    const businessId = session.businessId;
    const userId = session.userId;
    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search') || '';
    const filter = searchParams.get('filter') || 'all';
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '100');
    const offset = (page - 1) * limit;
    const updatedAfter = searchParams.get('updated_after'); // For delta sync (offline-first)

    // AUTHORIZATION: Check read permission
    try {
      await authorize(userId, 'customers', 'read', { businessId });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    try {
      await requirePlatformModule(businessId, 'billing', 'customers');
    } catch (error) {
      const denied = platformModuleErrorResponse(error);
      if (denied) return denied;
      throw error;
    }

    const params: any[] = [businessId];
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

    // Name, phone, or address. The payment screen searches the same way.
    if (search) {
      sql += ` AND (
        name ILIKE $${params.length + 1}
        OR company_name ILIKE $${params.length + 1}
        OR phone ILIKE $${params.length + 1}
        OR address ILIKE $${params.length + 1}
        OR billing_address ILIKE $${params.length + 1}
        OR shipping_address ILIKE $${params.length + 1}
        OR city ILIKE $${params.length + 1}
        OR state ILIKE $${params.length + 1}
        OR pincode ILIKE $${params.length + 1}
      )`;
      params.push(`%${search}%`);
    }

    // Add balance filter (simplified logic using opening_balance for now)
    // Real logic should sum up ledger entries or invoices
    if (filter === 'with-balance') {
      sql += ` AND current_balance > 0`;
    } else if (filter === 'zero-balance') {
      sql += ` AND current_balance = 0`;
    }

    // Customers recorded in one receivable account (Domestic Debtors, Foreign Debtors, ...).
    const receivableAccountParam = searchParams.get('receivable_account_id');
    if (receivableAccountParam && (await hasCustomerReceivableAccounts())) {
      try {
        const accountId = parseReceivableAccountId(receivableAccountParam);
        if (accountId) {
          const keep = await receivableAccountFilter(businessId, accountId);
          if (keep.includesUnassigned) {
            sql += ` AND receivable_account_id IS NULL`;
          } else {
            sql += ` AND receivable_account_id = ANY($${params.length + 1}::uuid[])`;
            params.push(keep.accountIds);
          }
        }
      } catch (error) {
        const refused = receivableAccountErrorResponse(error);
        if (refused) return refused;
        throw error;
      }
    }

    // Delta sync: only records updated after this timestamp
    if (updatedAfter) {
      sql += ` AND customers.updated_at >= $${params.length + 1}::timestamptz`;
      params.push(updatedAfter);
    }

    // Get total count for pagination (before adding LIMIT/OFFSET)
    const countParams = params.slice(0, params.length); // Copy params without limit/offset
    const countSql = sql.replace(/SELECT \*/, 'SELECT COUNT(*) as total');
    const countResult = await queryOne<{ total: number }>(countSql, countParams);
    const total = countResult?.total || 0;

    sql += ` ORDER BY name ASC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const customers = await queryRows<Customer>(sql, params);

    return NextResponse.json({ 
      customers, 
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error: any) {
    console.error('Error fetching customers:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireStrictSession(request);
    if (!session.ok) return session.response;
    const business_id = session.businessId;
    const created_by = session.userId;
    const body = await request.json();
    const { name } = body;

    if (!name) {
      return NextResponse.json(
        { error: 'name is required' },
        { status: 400 }
      );
    }

    // CRITICAL: Enforce access boundary - reject attendance-only employees
    const { checkEmployeeAccessBoundary } = await import('@/lib/access-boundary');
    const accessCheck = await checkEmployeeAccessBoundary(created_by, 'portal');
    if (!accessCheck.allowed) {
      return NextResponse.json(
        { error: accessCheck.reason, code: 'ACCESS_DENIED' },
        { status: 403 }
      );
    }

    // AUTHORIZATION: Check create permission
    try {
      await authorize(created_by, 'customers', 'create', { businessId: business_id });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    let result: Awaited<ReturnType<typeof createCustomer>>;
    try {
      result = await createCustomer({ businessId: business_id, userId: created_by }, body as CreateCustomerInput);
    } catch (e) {
      if (!(e instanceof CustomerAccessRefused)) throw e;
      const res = enforceAccessErrorResponse(e.reason);
      if (res) return res;
      throw e.reason;
    }

    if (!result.ok) {
      if (result.existing) {
        return NextResponse.json(
          { customer: result.existing, deduplicated: true, code: result.code, error: result.error },
          { status: result.status }
        );
      }
      if (result.code === CREATE_FAILED) {
        return NextResponse.json({ error: result.error }, { status: result.status });
      }
      return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
    }

    return NextResponse.json({ customer: result.record }, { status: 201 });
  } catch (error: any) {
    console.error('Error creating customer:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
