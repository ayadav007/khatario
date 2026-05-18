import { NextRequest, NextResponse } from 'next/server';
import { queryRows, queryOne, query, getPool } from '@/lib/db';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { getUserIdFromRequest, getBusinessIdFromRequest, getSessionScopedBusinessId } from '@/lib/auth-helpers';
import { enforceAccess, enforceAccessErrorResponse, isPrimaryAdminForBusiness } from '@/lib/enforce-access';
import { FeatureKeys } from '@/lib/featureKeys';

/**
 * Gateway rows for a sales order (payment_transactions), not accounting `payments`.
 * GET /api/payments?order_id=<sales_orders.id>
 */
async function getPaymentTransactionsForOrder(
  businessId: string,
  userId: string,
  orderId: string
): Promise<NextResponse> {
  const order = await queryOne<{ id: string; branch_id: string | null }>(
    `SELECT id, branch_id FROM sales_orders WHERE id = $1 AND business_id = $2`,
    [orderId, businessId]
  );

  if (!order) {
    return NextResponse.json({ error: 'Sales order not found' }, { status: 404 });
  }

  try {
    await authorize(userId, 'sales_orders', 'read', {
      branchId: order.branch_id ?? undefined,
      businessId,
    });
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return error.toNextResponse();
    }
    throw error;
  }

  const rows = await queryRows<{
    id: string;
    order_id: string;
    amount: string;
    currency: string;
    status: string;
    method: string;
    provider: string;
    utr: string | null;
    provider_payment_id: string | null;
    created_at: Date;
    updated_at: Date;
  }>(
    `SELECT
       id,
       order_id,
       amount::text,
       currency,
       status,
       method,
       provider,
       utr,
       provider_payment_id,
       created_at,
       updated_at
     FROM payment_transactions
     WHERE business_id = $1 AND order_id = $2
     ORDER BY created_at DESC`,
    [businessId, orderId]
  );

  return NextResponse.json({ payment_transactions: rows });
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId =
      getSessionScopedBusinessId(request) ?? getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request); // REQUIRED for authorization

    const orderIdParam = searchParams.get('order_id');
    if (orderIdParam) {
      if (!businessId) {
        return NextResponse.json({ error: 'business_id is required' }, { status: 400 });
      }
      if (!userId) {
        return NextResponse.json(
          { error: 'user_id is required for authorization' },
          { status: 400 }
        );
      }
      return getPaymentTransactionsForOrder(businessId, userId, orderIdParam);
    }

    /**
     * Reconciliation view for gateway transactions (payment_transactions), used by the admin screen.
     * GET /api/payments?reconciliation=1&status=&provider=&q=
     */
    const reconciliation = searchParams.get('reconciliation');
    if (reconciliation === '1' || reconciliation === 'true') {
      if (!businessId) {
        return NextResponse.json({ error: 'business_id is required' }, { status: 400 });
      }
      if (!userId) {
        return NextResponse.json(
          { error: 'user_id is required for authorization' },
          { status: 400 }
        );
      }

      // AUTHORIZATION: payment reconciliation is admin-only (primary admin or settings.read).
      try {
        await authorize(userId, 'payments', 'read');
      } catch (error) {
        if (error instanceof AuthorizationError) {
          return error.toNextResponse();
        }
        throw error;
      }

      const primaryForBusiness = await isPrimaryAdminForBusiness(userId, businessId).catch(
        () => false
      );
      let settingsAdmin = false;
      try {
        const { checkUserPermission } = await import('@/lib/permissions');
        settingsAdmin = await checkUserPermission(userId, 'settings', 'read');
      } catch {
        settingsAdmin = false;
      }
      if (!primaryForBusiness && !settingsAdmin) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }

      const status = searchParams.get('status');
      const provider = searchParams.get('provider');
      const q = searchParams.get('q');
      const limit = Math.min(parseInt(searchParams.get('limit') || '200', 10) || 200, 500);

      const params: any[] = [businessId];
      let i = 2;
      let sql = `
        SELECT
          pt.id,
          pt.order_id,
          pt.amount::text,
          pt.currency,
          pt.status,
          pt.method,
          pt.provider,
          pt.utr,
          pt.provider_payment_id,
          pt.raw_payload,
          pt.created_at,
          pt.updated_at,
          so.payment_status AS order_payment_status,
          so.payment_reference AS order_payment_reference,
          so.created_at AS order_created_at
        FROM payment_transactions pt
        JOIN sales_orders so ON so.id = pt.order_id AND so.business_id = pt.business_id
        WHERE pt.business_id = $1
      `;

      if (status && status !== 'all') {
        sql += ` AND pt.status = $${i}`;
        params.push(status);
        i++;
      }
      if (provider && provider !== 'all') {
        sql += ` AND LOWER(pt.provider) = LOWER($${i})`;
        params.push(provider);
        i++;
      }
      if (q && q.trim()) {
        sql += ` AND (
          pt.order_id::text ILIKE $${i}
          OR COALESCE(pt.provider_payment_id, '') ILIKE $${i}
          OR COALESCE(pt.utr, '') ILIKE $${i}
        )`;
        params.push(`%${q.trim()}%`);
        i++;
      }

      sql += ` ORDER BY pt.updated_at DESC NULLS LAST, pt.created_at DESC LIMIT $${i}`;
      params.push(limit);

      const rows = await queryRows(sql, params);
      return NextResponse.json({ payment_transactions: rows });
    }

    const type = searchParams.get('type'); // 'receivable' or 'payable'
    const customerId = searchParams.get('customer_id');
    const supplierId = searchParams.get('supplier_id');
    const referenceType = searchParams.get('reference_type');
    const referenceId = searchParams.get('reference_id');

    if (!businessId) {
      return NextResponse.json({ error: 'business_id is required' }, { status: 400 });
    }

    if (!userId) {
      return NextResponse.json(
        { error: 'user_id is required for authorization' },
        { status: 400 }
      );
    }

    // AUTHORIZATION: Check read permission
    try {
      await authorize(userId, 'payments', 'read');
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    // Get user's accessible branch IDs
    let accessibleBranchIds: string[] = [];
    let isAdmin = false; // settings.read / global primary admin; merged with business primary below
    try {
      const { getUserAccessibleBranchIds } = await import('@/lib/branch-access');
      accessibleBranchIds = await getUserAccessibleBranchIds(userId);
      
      // Check if user is admin (has settings.read permission or is primary admin)
      try {
        const { checkUserPermission } = await import('@/lib/permissions');
        isAdmin = await checkUserPermission(userId, 'settings', 'read');
      } catch (error) {
        // If permission check fails, assume not admin
        isAdmin = false;
      }
      
      // If admin check fails, try checking is_primary_admin
      if (!isAdmin) {
        try {
          const { queryOne } = await import('@/lib/db');
          const user = await queryOne<{ is_primary_admin: boolean }>(
            'SELECT is_primary_admin FROM users WHERE id = $1',
            [userId]
          );
          isAdmin = user?.is_primary_admin || false;
        } catch (error) {
          // Ignore error
        }
      }
    } catch (error) {
      console.error('Error fetching user accessible branches:', error);
      return NextResponse.json({ payments: [] });
    }

    const primaryForBusiness = await isPrimaryAdminForBusiness(userId, businessId).catch(() => false);
    isAdmin = isAdmin || primaryForBusiness;

    const branchIdParam = searchParams.get('branch_id'); // Optional: 'ALL' for consolidated, or specific branch

    let sql = `
      SELECT 
        p.*,
        c.name as customer_name,
        s.name as supplier_name
      FROM payments p
      LEFT JOIN customers c ON p.customer_id = c.id AND c.deleted_at IS NULL
      LEFT JOIN suppliers s ON p.supplier_id = s.id
      WHERE p.business_id = $1 AND p.deleted_at IS NULL
    `;
    const params: any[] = [businessId];
    let paramIndex = 2;

    // Filter by branch if specified
    if (branchIdParam && branchIdParam !== 'ALL' && branchIdParam !== 'all') {
      sql += ` AND p.branch_id = $${paramIndex}`;
      params.push(branchIdParam);
      paramIndex++;
    } else if (!isAdmin) {
      if (accessibleBranchIds.length === 0) {
        return NextResponse.json({ payments: [] });
      }
      sql += ` AND p.branch_id = ANY($${paramIndex}::uuid[])`;
      params.push(accessibleBranchIds);
      paramIndex++;
    }

    if (type) {
      sql += ` AND p.type = $${paramIndex}`;
      params.push(type);
      paramIndex++;
    }

    if (customerId) {
      sql += ` AND p.customer_id = $${paramIndex}`;
      params.push(customerId);
      paramIndex++;
    }

    if (supplierId) {
      sql += ` AND p.supplier_id = $${paramIndex}`;
      params.push(supplierId);
      paramIndex++;
    }

    if (referenceType) {
      sql += ` AND p.reference_type = $${paramIndex}`;
      params.push(referenceType);
      paramIndex++;
    }

    if (referenceId) {
      sql += ` AND p.reference_id = $${paramIndex}`;
      params.push(referenceId);
      paramIndex++;
    }

    sql += ` ORDER BY p.payment_date DESC, p.created_at DESC`;

    const payments = await queryRows(sql, params);

    return NextResponse.json({ payments });
  } catch (error: any) {
    console.error('Error fetching payments:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * POST /api/payments
 * Create a new payment (Payment In or Payment Out)
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    // Writes must never use client-supplied business_id alone — JWT/session is source of truth
    const sessionBusinessId = getSessionScopedBusinessId(request);
    const business_id = sessionBusinessId;
    const {
      branch_id, // MANDATORY: Branch (accounting entity) that processed this payment
      type, // 'receivable' (Payment In) or 'payable' (Payment Out)
      customer_id,
      supplier_id,
      reference_type, // 'invoice' or 'purchase'
      reference_id,
      amount,
      payment_mode = 'cash',
      payment_date,
      notes,
      created_by, // User ID who created the payment
    } = body;

    if (!business_id || !type || !amount || Number(amount) <= 0) {
      return NextResponse.json(
        { error: 'business_id, type, and amount are required' },
        { status: 400 }
      );
    }

    if (!created_by) {
      return NextResponse.json(
        { error: 'created_by (user_id) is required for authorization' },
        { status: 400 }
      );
    }

    // AUTHORIZATION: Check create permission
    // Note: We'll check branch access after branch_id is determined

    // CRITICAL: Resolve branch_id using helper (handles default branch fallback)
    // Try to get branch_id from reference if not provided
    let resolvedBranchId = branch_id;
    if (!resolvedBranchId && reference_type && reference_id) {
      if (reference_type === 'invoice') {
        const invoice = await queryOne<{ branch_id: string }>(
          'SELECT branch_id FROM invoices WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL',
          [reference_id, business_id]
        );
        if (invoice?.branch_id) {
          resolvedBranchId = invoice.branch_id;
        }
      } else if (reference_type === 'purchase') {
        const purchase = await queryOne<{ branch_id: string }>(
          'SELECT branch_id FROM purchases WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL',
          [reference_id, business_id]
        );
        if (purchase?.branch_id) {
          resolvedBranchId = purchase.branch_id;
        }
      }
    }

    const { resolveBranchId } = await import('@/lib/branch-helpers');
    let finalBranchId: string;
    try {
      finalBranchId = await resolveBranchId({
        branchId: resolvedBranchId,
        businessId: business_id,
      });
    } catch (error: any) {
      if (error.code === 'BRANCH_NOT_FOUND' || error.code === 'BRANCH_BUSINESS_MISMATCH' || error.code === 'BRANCH_INACTIVE') {
        return NextResponse.json(
          { error: error.message },
          { status: 400 }
        );
      }
      if (error.code === 'NO_DEFAULT_BRANCH') {
        return NextResponse.json(
          { error: error.message },
          { status: 500 }
        );
      }
      throw error;
    }

    // AUTHORIZATION: Check create permission with branch context
    try {
      await authorize(created_by, 'payments', 'create', { branchId: finalBranchId });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    try {
      await enforceAccess({
        businessId: business_id,
        userId: created_by,
        branchId: finalBranchId,
        feature: FeatureKeys.PAYMENT_TRACKING,
      });
    } catch (e) {
      const res = enforceAccessErrorResponse(e);
      if (res) return res;
      throw e;
    }

    // Validate branch exists, is active, and belongs to business (if not already validated)
    if (finalBranchId && branch_id) {
      const branchCheck = await queryOne<{ id: string; is_active: boolean }>(`
        SELECT id, is_active FROM branches 
        WHERE id = $1 AND business_id = $2
      `, [finalBranchId, business_id]);
      
      if (!branchCheck) {
        return NextResponse.json(
          { error: 'Invalid branch_id. Branch not found or does not belong to this business.' },
          { status: 400 }
        );
      }
      
      if (!branchCheck.is_active) {
        return NextResponse.json(
          { error: 'Branch is inactive. Cannot create payment for inactive branch.' },
          { status: 400 }
        );
      }
    }

    if (type === 'receivable' && !customer_id && !reference_id) {
      return NextResponse.json(
        { error: 'customer_id or reference_id is required for receivable payments' },
        { status: 400 }
      );
    }

    if (type === 'payable' && !supplier_id && !reference_id) {
      return NextResponse.json(
        { error: 'supplier_id or reference_id is required for payable payments' },
        { status: 400 }
      );
    }

    // Get customer/supplier from reference if not provided
    let finalCustomerId = customer_id;
    let finalSupplierId = supplier_id;

    if (reference_type === 'invoice' && reference_id) {
      const invoice = await queryOne(
        'SELECT customer_id, business_id FROM invoices WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL',
        [reference_id, business_id]
      );
      if (!invoice) {
        return NextResponse.json(
          { error: 'Invoice not found' },
          { status: 404 }
        );
      }
      // Verify business_id matches
      if (invoice.business_id !== business_id) {
        return NextResponse.json(
          { error: 'Invoice does not belong to this business' },
          { status: 403 }
        );
      }
      finalCustomerId = invoice.customer_id;
      if (!finalCustomerId && type === 'receivable') {
        return NextResponse.json(
          { error: 'Invoice does not have a customer associated' },
          { status: 400 }
        );
      }
    }

    if (reference_type === 'purchase' && reference_id) {
      const purchase = await queryOne(
        'SELECT supplier_id, business_id FROM purchases WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL',
        [reference_id, business_id]
      );
      if (!purchase) {
        return NextResponse.json(
          { error: 'Purchase not found' },
          { status: 404 }
        );
      }
      // Verify business_id matches
      if (purchase.business_id !== business_id) {
        return NextResponse.json(
          { error: 'Purchase does not belong to this business' },
          { status: 403 }
        );
      }
      finalSupplierId = purchase.supplier_id;
      if (!finalSupplierId && type === 'payable') {
        return NextResponse.json(
          { error: 'Purchase does not have a supplier associated' },
          { status: 400 }
        );
      }
    }

    // PHASE-5: ALL writes (payment row, balance updates, ledger postings) must
    // share one transaction so the deferred validate_voucher_balance trigger
    // sees both ledger lines at COMMIT. If anything throws, we ROLLBACK and
    // the payment row is rolled back too — no orphan payments without ledgers.
    const client = await getPool().connect();
    let payment: any = null;
    try {
      await client.query('BEGIN');

      // Insert payment
      const paymentRes = await client.query(
        `INSERT INTO payments (
          business_id, branch_id, type, customer_id, supplier_id, reference_type, reference_id,
          amount, payment_mode, payment_date, notes
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING *`,
        [
          business_id,
          finalBranchId,
          type,
          finalCustomerId || null,
          finalSupplierId || null,
          reference_type || null,
          reference_id || null,
          amount,
          payment_mode,
          payment_date || new Date(),
          notes || null,
        ],
      );
      payment = paymentRes.rows[0];

      // Update invoice/purchase paid_amount and customer/supplier balance
      if (reference_type === 'invoice' && reference_id) {
        const invRes = await client.query(
          'SELECT paid_amount, grand_total, customer_id FROM invoices WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL FOR UPDATE',
          [reference_id, business_id],
        );
        const invoice = invRes.rows[0];
        if (invoice) {
          const newPaidAmount = Number(invoice.paid_amount || 0) + Number(amount);
          const balance = Math.max(0, Number(invoice.grand_total || 0) - newPaidAmount);
          let paymentStatus: 'unpaid' | 'partially_paid' | 'paid' = 'unpaid';
          if (newPaidAmount <= 0) paymentStatus = 'unpaid';
          else if (balance <= 0) paymentStatus = 'paid';
          else paymentStatus = 'partially_paid';

          await client.query(
            `UPDATE invoices
             SET paid_amount = $1, balance_amount = $2, payment_status = $3, updated_at = CURRENT_TIMESTAMP
             WHERE id = $4 AND business_id = $5`,
            [newPaidAmount, balance, paymentStatus, reference_id, business_id],
          );

          if (invoice.customer_id) {
            await client.query(
              `UPDATE customers
               SET current_balance = current_balance - $1,
                   updated_at = CURRENT_TIMESTAMP
               WHERE id = $2 AND business_id = $3`,
              [amount, invoice.customer_id, business_id],
            );
          }
        }
      }

      if (reference_type === 'purchase' && reference_id) {
        const purRes = await client.query(
          'SELECT paid_amount, grand_total, supplier_id FROM purchases WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL FOR UPDATE',
          [reference_id, business_id],
        );
        const purchase = purRes.rows[0];
        if (purchase) {
          const newPaidAmount = Number(purchase.paid_amount || 0) + Number(amount);
          const balance = Math.max(0, Number(purchase.grand_total || 0) - newPaidAmount);
          let paymentStatus: 'unpaid' | 'partially_paid' | 'paid' = 'unpaid';
          if (newPaidAmount <= 0) paymentStatus = 'unpaid';
          else if (balance <= 0) paymentStatus = 'paid';
          else paymentStatus = 'partially_paid';

          await client.query(
            `UPDATE purchases
             SET paid_amount = $1, balance_amount = $2, payment_status = $3, updated_at = CURRENT_TIMESTAMP
             WHERE id = $4 AND business_id = $5`,
            [newPaidAmount, balance, paymentStatus, reference_id, business_id],
          );

          if (purchase.supplier_id) {
            await client.query(
              `UPDATE suppliers
               SET current_balance = current_balance - $1,
                   updated_at = CURRENT_TIMESTAMP
               WHERE id = $2 AND business_id = $3`,
              [amount, purchase.supplier_id, business_id],
            );
          }
        }
      }

      // Handle standalone payments (not linked to invoice/purchase)
      if (!reference_id && type === 'receivable' && finalCustomerId) {
        await client.query(
          `UPDATE customers
           SET current_balance = current_balance - $1,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $2 AND business_id = $3`,
          [amount, finalCustomerId, business_id],
        );
      }

      if (!reference_id && type === 'payable' && finalSupplierId) {
        await client.query(
          `UPDATE suppliers
           SET current_balance = current_balance - $1,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $2 AND business_id = $3`,
          [amount, finalSupplierId, business_id],
        );
      }

      // Create ledger entries (same transaction; deferred trigger fires at COMMIT)
      const { createPaymentLedgerEntries } = await import('@/lib/ledger-utils');
      await createPaymentLedgerEntries({
        businessId: business_id,
        paymentId: payment.id,
        paymentDate: payment_date || new Date(),
        amount: amount,
        type: type as 'receivable' | 'payable',
        customerId: finalCustomerId || null,
        supplierId: finalSupplierId || null,
        paymentMode: payment_mode || 'cash',
        referenceNumber: reference_id ? `${reference_type}-${reference_id.substring(0, 8)}` : undefined,
        description: notes || `Payment ${type === 'receivable' ? 'received' : 'made'}${reference_id ? ` for ${reference_type}` : ''}`,
        branchId: finalBranchId,
        poolClient: client,
      });

      await client.query('COMMIT');
    } catch (txError: any) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('Error creating payment (transaction rolled back):', txError);
      return NextResponse.json(
        {
          error: txError.message || 'Failed to create payment',
          details: txError.detail || undefined,
        },
        { status: 500 },
      );
    } finally {
      client.release();
    }

    if (payment) {
      const { logActivity, getClientIP, getUserAgent } = await import('@/lib/activity-logger');
      await logActivity({
        business_id,
        user_id: created_by,
        action_type: 'create',
        module: 'payments',
        entity_id: payment.id,
        entity_type: 'payment',
        description:
          type === 'receivable'
            ? `Recorded payment in of ₹${Number(amount).toLocaleString('en-IN')}`
            : `Recorded payment out of ₹${Number(amount).toLocaleString('en-IN')}`,
        ip_address: getClientIP(request),
        user_agent: getUserAgent(request),
        metadata: {
          type,
          amount: Number(amount),
          payment_mode,
          reference_type: reference_type || null,
          reference_id: reference_id || null,
          customer_id: finalCustomerId || null,
          supplier_id: finalSupplierId || null,
          branch_id: finalBranchId,
        },
      });
    }

    return NextResponse.json({ payment }, { status: 201 });
  } catch (error: any) {
    console.error('Error creating payment:', error);
    return NextResponse.json({ error: error.message || 'Failed to create payment' }, { status: 500 });
  }
}

