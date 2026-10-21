import { NextRequest, NextResponse } from 'next/server';
import { query, queryRows, queryOne, getPool } from '@/lib/db';
import { Customer } from '@/types/database';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { requireStrictSession } from '@/lib/auth-helpers';
import {
  enforceAccess,
  enforceAccessErrorResponse,
  isPrimaryAdminForBusiness,
} from '@/lib/enforce-access';
import { FeatureKeys } from '@/lib/featureKeys';
import { normalizePhoneOrNull } from '@/lib/utils/phone';
import { resolveGstinAndState } from '@/lib/tax/gstin';
import {
  requirePlatformModule,
  platformModuleErrorResponse,
} from '@/lib/security/require-platform-module';

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
    const {
      name,
      company_name,
      phone,
      email,
      address,
      billing_address,
      shipping_address,
      city, // Billing city
      state, // Billing state
      state_code, // GST state code (2-digit)
      pincode, // Billing pincode
      shipping_city,
      shipping_state,
      shipping_pincode,
      country,
      gstin,
      opening_balance = 0,
      opening_balance_type = 'debit',
      credit_limit = 0,
      credit_days: bodyCreditDays,
    } = body;

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

    const hadPhoneDigits =
      phone != null && String(phone).replace(/\D/g, '').length > 0;
    const phoneNorm = normalizePhoneOrNull(phone);
    if (hadPhoneDigits && phoneNorm == null) {
      return NextResponse.json(
        {
          error:
            'Enter a valid phone number (8–15 digits including country code).',
          code: 'INVALID_PHONE',
        },
        { status: 400 }
      );
    }
    const emailNorm =
      typeof email === 'string' && email.trim() !== '' ? email.trim().toLowerCase() : null;

    let creditDays: number | null = null;
    if (bodyCreditDays !== undefined && bodyCreditDays !== null && bodyCreditDays !== '') {
      const n = parseInt(String(bodyCreditDays), 10);
      if (Number.isFinite(n) && n >= 0) creditDays = n;
    }

    if (phoneNorm) {
      const existingPhone = await queryOne<Customer>(
        `SELECT * FROM customers
         WHERE business_id = $1 AND is_active = true AND deleted_at IS NULL AND phone IS NOT NULL AND trim(phone) = $2
         LIMIT 1`,
        [business_id, phoneNorm]
      );
      if (existingPhone) {
        const name = existingPhone.name?.trim();
        return NextResponse.json(
          {
            customer: existingPhone,
            deduplicated: true,
            code: 'DUPLICATE_PHONE',
            error: name
              ? `A customer named ${name} already uses this phone number.`
              : 'A customer with this phone number already exists.',
          },
          { status: 200 }
        );
      }
    }
    if (emailNorm) {
      const existingEmail = await queryOne<Customer>(
        `SELECT * FROM customers
         WHERE business_id = $1 AND is_active = true AND deleted_at IS NULL AND email IS NOT NULL AND lower(trim(email)) = $2
         LIMIT 1`,
        [business_id, emailNorm]
      );
      if (existingEmail) {
        const name = existingEmail.name?.trim();
        return NextResponse.json(
          {
            customer: existingEmail,
            deduplicated: true,
            code: 'DUPLICATE_EMAIL',
            error: name
              ? `A customer named ${name} already uses this email.`
              : 'A customer with this email already exists.',
          },
          { status: 200 }
        );
      }
    }

    const finalBillingAddress = billing_address || address || null;
    const finalShippingAddress = shipping_address || address || null;

    const getStateCode = (stateName: string): string => {
      if (!stateName) return '';
      const name = stateName.trim().toLowerCase();
      const map: Record<string, string> = {
        'andhra pradesh': '37', 'karnataka': '29', 'tamil nadu': '33', 'maharashtra': '27',
        'gujarat': '24', 'rajasthan': '08', 'uttar pradesh': '09', 'west bengal': '19',
        'delhi': '07', 'telangana': '36', 'haryana': '06', 'punjab': '03', 'odisha': '21',
        'bihar': '10', 'madhya pradesh': '23', 'assam': '18', 'jharkhand': '20',
        'kerala': '32', 'chhattisgarh': '22', 'uttarakhand': '05', 'himachal pradesh': '02',
        'tripura': '16', 'manipur': '14', 'meghalaya': '17', 'mizoram': '15',
        'nagaland': '13', 'arunachal pradesh': '12', 'goa': '30', 'sikkim': '11',
        'andaman and nicobar islands': '35', 'chandigarh': '04',
        'dadra and nagar haveli and daman and diu': '26', 'jammu and kashmir': '01',
        'ladakh': '38', 'lakshadweep': '31', 'puducherry': '34',
      };
      return map[name] || '';
    };

    const gstinCheck = resolveGstinAndState({ gstin, state, state_code });
    if (!gstinCheck.ok) {
      return NextResponse.json({ error: gstinCheck.error, code: gstinCheck.code }, { status: 400 });
    }
    const finalState = gstinCheck.state;
    const finalStateCode = gstinCheck.state_code || (finalState ? getStateCode(finalState) : null);

    const sql = `
      INSERT INTO customers (
        business_id, name, company_name, phone, email, address, billing_address, shipping_address,
        city, state, state_code, pincode, shipping_city, shipping_state, shipping_pincode,
        country, gstin, opening_balance, opening_balance_type, credit_limit, credit_days
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
      RETURNING *
    `;

    const pool = getPool();
    const client = await pool.connect();
    let customer: Customer | null = null;

    try {
      await client.query('BEGIN');

      try {
        await enforceAccess({
          businessId: business_id,
          userId: created_by,
          feature: FeatureKeys.CUSTOMER_MANAGEMENT,
          limitType: 'customers',
          poolClient: client,
        });
      } catch (e) {
        await client.query('ROLLBACK');
        const res = enforceAccessErrorResponse(e);
        if (res) return res;
        throw e;
      }

      const insertResult = await client.query<Customer>(sql, [
          business_id,
          name,
          company_name || null,
          phoneNorm,
          emailNorm,
          address || null,
          finalBillingAddress,
          finalShippingAddress,
          city || null,
          finalState,
          finalStateCode || null,
          pincode || null,
          shipping_city || null,
          shipping_state || null,
          shipping_pincode || null,
          country || 'India',
          gstinCheck.gstin,
          opening_balance,
          opening_balance_type,
          credit_limit,
          creditDays,
        ]);

        customer = insertResult.rows[0] ?? null;
        if (!customer) {
          await client.query('ROLLBACK');
          return NextResponse.json(
            { error: 'Failed to create customer' },
            { status: 500 }
          );
        }

      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }

    if (opening_balance > 0 && customer) {
      try {
        const { postOpeningBalanceLedgerEntry } = await import('@/lib/ledger-utils');
        await postOpeningBalanceLedgerEntry({
          businessId: business_id,
          entityType: 'customer',
          entityId: customer.id,
          entityName: name,
          openingBalance: opening_balance,
          openingBalanceType: opening_balance_type,
        });
      } catch (ledgerError: any) {
        console.error('Error posting opening balance ledger entry for customer:', ledgerError);
      }
    }

    return NextResponse.json({ customer }, { status: 201 });
  } catch (error: any) {
    console.error('Error creating customer:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
