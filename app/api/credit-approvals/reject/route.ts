import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { checkUserPermission } from '@/lib/permissions';

/**
 * POST /api/credit-approvals/reject
 * Reject a credit approval request
 * Only Admin / Finance roles can reject
 */
export async function POST(request: NextRequest) {
  const pool = getPool();
  const client = await pool.connect();

  try {
    const body = await request.json();
    const {
      approval_id,
      rejected_by,
      business_id,
      rejection_reason,
    } = body;

    if (!approval_id || !rejected_by || !business_id) {
      client.release();
      return NextResponse.json(
        { error: 'approval_id, rejected_by, and business_id are required' },
        { status: 400 }
      );
    }

    // AUTHORIZATION: Check if user has admin/finance permissions
    const hasInvoicesFinalize = await checkUserPermission(rejected_by, 'invoices', 'finalize');
    const hasPurchasesFinalize = await checkUserPermission(rejected_by, 'purchases', 'finalize');
    const hasAdminAccess = hasInvoicesFinalize || hasPurchasesFinalize;

    if (!hasAdminAccess) {
      client.release();
      return NextResponse.json(
        { error: 'Only Admin or Finance users can reject credit requests' },
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

    // Update approval with rejection
    const updatedApproval = await client.query(
      `UPDATE credit_approvals
       SET status = 'rejected',
           approved_by = $1,
           approved_at = CURRENT_TIMESTAMP,
           reason = COALESCE($2, reason),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $3
       RETURNING *`,
      [rejected_by, rejection_reason || null, approval_id]
    );

    // Create notification
    await client.query(
      `INSERT INTO notifications (
        business_id, type, title, message, reference_type, reference_id, created_at
      ) VALUES ($1, 'general', $2, $3, $4, $5, CURRENT_TIMESTAMP)`,
      [
        business_id,
        `Credit Approval Rejected: ${approval.reference_type === 'invoice' ? 'Invoice' : 'Purchase'}`,
        `Credit limit approval has been rejected for ${approval.reference_type} ${approval.reference_id}. Reason: ${rejection_reason || 'Not provided'}`,
        approval.reference_type,
        approval.reference_id
      ]
    );

    await client.query('COMMIT');
    client.release();

    return NextResponse.json({ approval: updatedApproval.rows[0] });
  } catch (error: any) {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
    console.error('Error rejecting credit approval:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to reject credit approval' },
      { status: 500 }
    );
  }
}
