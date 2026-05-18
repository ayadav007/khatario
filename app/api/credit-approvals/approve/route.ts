import { NextRequest, NextResponse } from 'next/server';
import { getPool, queryOne } from '@/lib/db';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { checkUserPermission } from '@/lib/permissions';
import { checkAndSendCreditAlerts } from '@/lib/credit-alerts';
import { calculateCreditMetrics } from '@/lib/credit-utils';

/**
 * POST /api/credit-approvals/approve
 * Approve a credit approval request
 * Only Admin / Finance roles can approve
 */
export async function POST(request: NextRequest) {
  const pool = getPool();
  const client = await pool.connect();

  try {
    const body = await request.json();
    const {
      approval_id,
      approved_by,
      business_id,
    } = body;

    if (!approval_id || !approved_by || !business_id) {
      client.release();
      return NextResponse.json(
        { error: 'approval_id, approved_by, and business_id are required' },
        { status: 400 }
      );
    }

    // AUTHORIZATION: Check if user has admin/finance permissions
    // Check for invoices or purchases finalize permission (admin/finance typically have this)
    const hasInvoicesFinalize = await checkUserPermission(approved_by, 'invoices', 'finalize');
    const hasPurchasesFinalize = await checkUserPermission(approved_by, 'purchases', 'finalize');
    const hasAdminAccess = hasInvoicesFinalize || hasPurchasesFinalize;

    if (!hasAdminAccess) {
      client.release();
      return NextResponse.json(
        { error: 'Only Admin or Finance users can approve credit requests' },
        { status: 403 }
      );
    }

    await client.query('BEGIN');

    // Fetch approval
    const approvalResult = await client.query(
      `SELECT * FROM credit_approvals WHERE id = $1 AND business_id = $2`,
      [approval_id, business_id]
    );

    if (approvalResult.rows.length === 0) {
      await client.query('ROLLBACK');
      client.release();
      return NextResponse.json({ error: 'Approval not found' }, { status: 404 });
    }

    const approval = approvalResult.rows[0];

    if (approval.status !== 'pending') {
      await client.query('ROLLBACK');
      client.release();
      return NextResponse.json(
        { error: `Approval is already ${approval.status}` },
        { status: 400 }
      );
    }

    // Update approval
    const updatedApproval = await client.query(
      `UPDATE credit_approvals
       SET status = 'approved',
           approved_by = $1,
           approved_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $2
       RETURNING *`,
      [approved_by, approval_id]
    );

    // Create notification
    await client.query(
      `INSERT INTO notifications (
        business_id, type, title, message, reference_type, reference_id, created_at
      ) VALUES ($1, 'general', $2, $3, $4, $5, CURRENT_TIMESTAMP)`,
      [
        business_id,
        `Credit Approval Approved: ${approval.reference_type === 'invoice' ? 'Invoice' : 'Purchase'}`,
        `Credit limit approval has been approved for ${approval.reference_type} ${approval.reference_id}. You can now finalize the ${approval.reference_type}.`,
        approval.reference_type,
        approval.reference_id
      ]
    );

    await client.query('COMMIT');
    client.release();

    // PHASE 5.4: Send credit alert for approval (async, non-blocking)
    const entityTable = approval.entity_type === 'customer' ? 'customers' : 'suppliers';
    const entity = await queryOne<{ name: string; credit_limit: string | null; current_balance: string | null }>(
      `SELECT name, credit_limit, current_balance FROM ${entityTable} WHERE id = $1 AND business_id = $2`,
      [approval.entity_id, business_id]
    );
    
    if (entity) {
      const metrics = calculateCreditMetrics(entity.credit_limit, entity.current_balance);
      checkAndSendCreditAlerts(
        business_id,
        approval.entity_type,
        approval.entity_id,
        entity.credit_limit,
        entity.current_balance,
        metrics,
        approval.reference_type,
        approval.reference_id
      ).catch(err => console.error('Error sending credit alert for approval:', err));
    }

    return NextResponse.json({ approval: updatedApproval.rows[0] });
  } catch (error: any) {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
    console.error('Error approving credit approval:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to approve credit approval' },
      { status: 500 }
    );
  }
}
