import { NextRequest, NextResponse } from 'next/server';
import { queryOne, query, queryRows } from '@/lib/db';
import { Customer, Payment, Invoice } from '@/types/database';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { getBusinessIdFromRequest, getUserIdFromRequest } from '@/lib/auth-helpers';
import { normalizePhoneOrNull } from '@/lib/utils/phone';

/** Only real `customers` columns; prevents unknown JSON keys from breaking dynamic UPDATE. */
const CUSTOMER_UPDATABLE = new Set([
  'name',
  'company_name',
  'phone',
  'email',
  'address',
  'billing_address',
  'shipping_address',
  'city',
  'state',
  'state_code',
  'pincode',
  'shipping_city',
  'shipping_state',
  'shipping_pincode',
  'country',
  'gstin',
  'opening_balance',
  'opening_balance_type',
  'credit_limit',
  'credit_days',
  'tags',
  'notes',
  'is_active',
]);

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const customerId = params.id;
    const userId = getUserIdFromRequest(request);
    
    if (!userId) {
      return NextResponse.json(
        { error: 'user_id is required for authorization' },
        { status: 400 }
      );
    }

    const businessScope = getBusinessIdFromRequest(request);
    if (!businessScope) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    // Get customer (scoped to JWT/session tenant — no cross-business row access by id guess)
    const customer = await queryOne<Customer>(
      'SELECT * FROM customers WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL',
      [customerId, businessScope]
    );

    if (!customer) {
      return NextResponse.json({ error: 'Customer not found' }, { status: 404 });
    }

    // AUTHORIZATION: Check read permission
    try {
      await authorize(userId, 'customers', 'read', { businessId: customer.business_id });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    // Get user's accessible branch IDs for filtering transactions
    let accessibleBranchIds: string[] = [];
    try {
      const { getUserAccessibleBranchIds } = await import('@/lib/branch-access');
      accessibleBranchIds = await getUserAccessibleBranchIds(userId);
    } catch (error) {
      console.error('Error fetching user accessible branches:', error);
      // Continue without branch filtering if error
    }

    // Get transactions (invoices and payments) - filtered by user's accessible branches
    const invoiceBranchFilter = accessibleBranchIds.length > 0 
      ? `AND branch_id = ANY($3::uuid[])`
      : '';
    const paymentBranchFilter = accessibleBranchIds.length > 0 
      ? `AND branch_id = ANY($3::uuid[])`
      : '';
    
    const transactionParams = accessibleBranchIds.length > 0 
      ? [customerId, businessScope, accessibleBranchIds]
      : [customerId, businessScope];

    const invoiceRows = await queryRows<any>(
      `
      SELECT 
        'invoice' as type,
        id,
        invoice_number as ref_no,
        invoice_date as date,
        grand_total as amount,
        paid_amount,
        balance_amount,
        document_type,
        status::text as status,
        payment_status::text as payment_status,
        estimate_status::text as estimate_status,
        NULL::text as payment_mode
      FROM invoices
      WHERE customer_id = $1
        AND business_id = $2
        AND deleted_at IS NULL
        ${invoiceBranchFilter}
      ORDER BY invoice_date DESC
      LIMIT 50
    `,
      transactionParams
    );

    const paymentRows = await queryRows<any>(
      `
      SELECT 
        'payment' as type,
        id,
        'PAY-' || SUBSTRING(id::text, 1, 8) as ref_no,
        payment_date as date,
        -amount as amount,
        amount as paid_amount,
        0 as balance_amount,
        NULL::text as document_type,
        NULL::text as status,
        NULL::text as payment_status,
        NULL::text as estimate_status,
        payment_mode::text as payment_mode
      FROM payments
      WHERE customer_id = $1
        AND business_id = $2
        AND deleted_at IS NULL
        ${paymentBranchFilter}
      ORDER BY payment_date DESC
      LIMIT 50
    `,
      transactionParams
    );

    const transactions = [...invoiceRows, ...paymentRows].sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    );

    // Use current_balance which already includes opening balance + invoices - payments
    const totalReceivable = Number(customer.current_balance) || 0;

    return NextResponse.json({
      customer,
      transactions,
      totalReceivable,
    });
  } catch (error: any) {
    console.error('Error fetching customer:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const customerId = params.id;
    const body = await request.json();
    const { user_id, updated_by, business_id: _bodyBusinessId, ...raw } = body;
    const userId = getUserIdFromRequest(request, body) || updated_by;

    const updateData: Record<string, unknown> = {};
    for (const key of Object.keys(raw)) {
      if (key !== 'id' && CUSTOMER_UPDATABLE.has(key) && raw[key] !== undefined) {
        updateData[key] = raw[key];
      }
    }

    if ('credit_days' in updateData) {
      const v = updateData.credit_days;
      if (v === '' || v === null || v === undefined) {
        updateData.credit_days = null;
      } else {
        const n = parseInt(String(v), 10);
        updateData.credit_days = Number.isFinite(n) && n >= 0 ? n : null;
      }
    }

    if (!userId) {
      return NextResponse.json(
        { error: 'user_id or updated_by is required for authorization' },
        { status: 400 }
      );
    }

    const businessScope = getBusinessIdFromRequest(request, body);
    if (!businessScope) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    // Get customer first to check business_id (scoped to JWT tenant)
    const existingCustomer = await queryOne<Customer>(
      'SELECT * FROM customers WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL',
      [customerId, businessScope]
    );

    if (!existingCustomer) {
      return NextResponse.json({ error: 'Customer not found' }, { status: 404 });
    }

    // AUTHORIZATION: Check update permission
    try {
      await authorize(userId, 'customers', 'update', { 
        businessId: existingCustomer.business_id,
        resourceId: customerId
      });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    // PHASE 2: Lock opening balance only when it *changes* (the edit form always resends the same values)
    const sameMoney = (a: unknown, b: unknown) => {
      const na = a == null || a === '' ? 0 : Number(a);
      const nb = b == null || b === '' ? 0 : Number(b);
      if (Number.isNaN(na) && Number.isNaN(nb)) return true;
      if (Number.isNaN(na) || Number.isNaN(nb)) return false;
      return Math.abs(na - nb) < 0.0001;
    };
    const existingObt = String((existingCustomer as { opening_balance_type?: string }).opening_balance_type ?? 'debit');
    const newOb = updateData.opening_balance;
    const newObt = updateData.opening_balance_type;

    const openingBalanceChanged =
      newOb !== undefined && !sameMoney(existingCustomer.opening_balance, newOb);
    const openingBalanceTypeChanged =
      newObt !== undefined && String(newObt) !== existingObt;

    if (openingBalanceChanged || openingBalanceTypeChanged) {
      const { customerHasTransactions } = await import('@/lib/ledger-utils');
      const hasTransactions = await customerHasTransactions(customerId);

      if (hasTransactions) {
        return NextResponse.json(
          {
            error: 'Opening balance cannot be modified once transactions exist for this customer',
            code: 'OPENING_BALANCE_LOCKED',
          },
          { status: 400 }
        );
      }
    }

    if (updateData.phone !== undefined) {
      const rawPhone = updateData.phone;
      const hadNonEmpty =
        rawPhone != null && String(rawPhone).replace(/\D/g, '').length > 0;
      const normalized = normalizePhoneOrNull(rawPhone);
      if (hadNonEmpty && normalized == null) {
        return NextResponse.json(
          {
            error:
              'Enter a valid phone number (8–15 digits including country code).',
            code: 'INVALID_PHONE',
          },
          { status: 400 }
        );
      }
      updateData.phone = normalized;
    }

    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    Object.keys(updateData).forEach((key) => {
      if (key !== 'id' && updateData[key] !== undefined) {
        updates.push(`${key} = $${paramIndex}`);
        values.push(updateData[key]);
        paramIndex++;
      }
    });

    if (updates.length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    values.push(customerId);
    values.push(existingCustomer.business_id);
    const sql = `
      UPDATE customers 
      SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP
      WHERE id = $${paramIndex} AND business_id = $${paramIndex + 1}
      RETURNING *
    `;

    const customer = await queryOne<Customer>(sql, values);

    return NextResponse.json({ customer });
  } catch (error: any) {
    console.error('Error updating customer:', error);
    if (error?.code === '23505') {
      return NextResponse.json(
        {
          error:
            'Another customer in your business already uses this phone or email. Use a different value or merge duplicates.',
          code: 'DUPLICATE_CUSTOMER',
        },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: error.message || 'Update failed' }, { status: 500 });
  }
}

