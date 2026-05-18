import { NextRequest, NextResponse } from 'next/server';
import { getPool, queryOne } from '@/lib/db';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { calculateProjectedCreditMetrics } from '@/lib/credit-utils';
import { checkAndSendCreditAlerts } from '@/lib/credit-alerts';

/**
 * POST /api/credit-approvals/request
 * Request credit approval for an invoice or purchase
 * Allowed when projected credit exceeds limit
 */
export async function POST(request: NextRequest) {
  const pool = getPool();
  const client = await pool.connect();

  try {
    const body = await request.json();
    const {
      business_id,
      entity_type, // 'customer' | 'supplier'
      entity_id,
      reference_type, // 'invoice' | 'purchase'
      reference_id,
      requested_by,
      reason,
    } = body;

    if (!business_id || !entity_type || !entity_id || !reference_type || !reference_id || !requested_by) {
      client.release();
      return NextResponse.json(
        { error: 'business_id, entity_type, entity_id, reference_type, reference_id, and requested_by are required' },
        { status: 400 }
      );
    }

    // Validate entity_type and reference_type
    if (!['customer', 'supplier'].includes(entity_type)) {
      client.release();
      return NextResponse.json(
        { error: 'entity_type must be "customer" or "supplier"' },
        { status: 400 }
      );
    }

    if (!['invoice', 'purchase'].includes(reference_type)) {
      client.release();
      return NextResponse.json(
        { error: 'reference_type must be "invoice" or "purchase"' },
        { status: 400 }
      );
    }

    // AUTHORIZATION: Check that user can create invoices/purchases
    try {
      const moduleKey = reference_type === 'invoice' ? 'invoices' : 'purchases';
      await authorize(requested_by, moduleKey, 'create', { businessId: business_id });
    } catch (error) {
      client.release();
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    await client.query('BEGIN');

    // Verify reference exists and get details
    let reference: any = null;
    if (reference_type === 'invoice') {
      const invoiceResult = await client.query(
        `SELECT id, customer_id, grand_total, paid_amount, balance_amount, status, business_id
         FROM invoices WHERE id = $1 AND business_id = $2`,
        [reference_id, business_id]
      );
      if (invoiceResult.rows.length === 0) {
        await client.query('ROLLBACK');
        client.release();
        return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
      }
      reference = invoiceResult.rows[0];
      
      // Verify entity_id matches
      if (reference.customer_id !== entity_id) {
        await client.query('ROLLBACK');
        client.release();
        return NextResponse.json(
          { error: 'Customer ID does not match invoice customer' },
          { status: 400 }
        );
      }
    } else {
      const purchaseResult = await client.query(
        `SELECT id, supplier_id, grand_total, paid_amount, balance_amount, status, business_id
         FROM purchases WHERE id = $1 AND business_id = $2`,
        [reference_id, business_id]
      );
      if (purchaseResult.rows.length === 0) {
        await client.query('ROLLBACK');
        client.release();
        return NextResponse.json({ error: 'Purchase not found' }, { status: 404 });
      }
      reference = purchaseResult.rows[0];
      
      // Verify entity_id matches
      if (reference.supplier_id !== entity_id) {
        await client.query('ROLLBACK');
        client.release();
        return NextResponse.json(
          { error: 'Supplier ID does not match purchase supplier' },
          { status: 400 }
        );
      }
    }

    // Check if credit limit is actually exceeded
    const entityTableName = entity_type === 'customer' ? 'customers' : 'suppliers';
    const entityData = await client.query(
      `SELECT credit_limit, current_balance FROM ${entityTableName} WHERE id = $1 AND business_id = $2`,
      [entity_id, business_id]
    );

    if (entityData.rows.length === 0) {
      await client.query('ROLLBACK');
      client.release();
      return NextResponse.json(
        { error: `${entity_type} not found` },
        { status: 404 }
      );
    }

    const creditLimit = parseFloat(entityData.rows[0].credit_limit ?? '0');
    const currentBalance = parseFloat(entityData.rows[0].current_balance ?? '0');
    
    // Calculate projected balance
    const referenceBalance = reference.balance_amount ?? (parseFloat(reference.grand_total ?? '0') - parseFloat(reference.paid_amount ?? '0'));
    const projectedMetrics = calculateProjectedCreditMetrics(creditLimit, currentBalance, referenceBalance);

    // Only allow approval request if credit limit is exceeded or will be exceeded
    if (creditLimit === 0 || projectedMetrics.credit_status !== 'OVER_LIMIT') {
      await client.query('ROLLBACK');
      client.release();
      return NextResponse.json(
        { error: 'Credit limit not exceeded. Approval not required.' },
        { status: 400 }
      );
    }

    // Check for existing pending approval
    const existingApproval = await client.query(
      `SELECT id, status FROM credit_approvals
       WHERE business_id = $1 AND reference_type = $2 AND reference_id = $3 AND status = 'pending'`,
      [business_id, reference_type, reference_id]
    );

    if (existingApproval.rows.length > 0) {
      await client.query('ROLLBACK');
      client.release();
      return NextResponse.json(
        { error: 'Pending approval already exists for this reference' },
        { status: 409 }
      );
    }

    // Create approval request
    const approvalResult = await client.query(
      `INSERT INTO credit_approvals (
        business_id, entity_type, entity_id, reference_type, reference_id,
        requested_by, status, reason
      ) VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7)
      RETURNING *`,
      [business_id, entity_type, entity_id, reference_type, reference_id, requested_by, reason || null]
    );

    const approval = approvalResult.rows[0];

    // Create notification for admin/finance users
    await client.query(
      `INSERT INTO notifications (
        business_id, type, title, message, reference_type, reference_id, created_at
      ) VALUES ($1, 'general', $2, $3, $4, $5, CURRENT_TIMESTAMP)`,
      [
        business_id,
        `Credit Approval Requested: ${reference_type === 'invoice' ? 'Invoice' : 'Purchase'}`,
        `Credit limit approval requested for ${entity_type} ${entity_id}. ${reference_type === 'invoice' ? 'Invoice' : 'Purchase'} ${reference_id} would exceed credit limit. Reason: ${reason || 'Not provided'}`,
        reference_type,
        reference_id
      ]
    );

    await client.query('COMMIT');
    client.release();

    // PHASE 5.4: Send credit alert for approval request (async, non-blocking)
    const entityTableName2 = entity_type === 'customer' ? 'customers' : 'suppliers';
    const entity = await queryOne<{ name: string }>(
      `SELECT name FROM ${entityTableName2} WHERE id = $1 AND business_id = $2`,
      [entity_id, business_id]
    );
    
    if (entity) {
      checkAndSendCreditAlerts(
        business_id,
        entity_type,
        entity_id,
        creditLimit,
        currentBalance,
        projectedMetrics,
        reference_type,
        reference_id
      ).catch(err => console.error('Error sending credit alert for approval request:', err));
    }

    return NextResponse.json({ approval }, { status: 201 });
  } catch (error: any) {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
    console.error('Error creating credit approval request:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to create approval request' },
      { status: 500 }
    );
  }
}
