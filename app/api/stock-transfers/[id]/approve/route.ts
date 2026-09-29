import { NextRequest, NextResponse } from 'next/server';
import { getPool, queryOne } from '@/lib/db';
import { assertFeatureAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { ensureInterBranchInvoiceForTransfer } from '@/lib/inter-branch-utils';
import { getUserIdFromRequest, requireTenantBusinessId } from '@/lib/auth-helpers';
import { periodGuardResponse } from '@/lib/http/period-guards';

export const dynamic = 'force-dynamic';

/**
 * POST /api/stock-transfers/[id]/approve
 * Approve a stock transfer (changes status from 'draft' or 'pending_approval' to 'pending')
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const pool = getPool();
  const client = await pool.connect();

  try {
    const body = await request.json();
    const { approval_notes } = body;

    const tenant = requireTenantBusinessId(request, body.business_id);
    if (!tenant.ok) return tenant.response;
    const userId = getUserIdFromRequest(request);
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const transferResult = await client.query(
      `SELECT * FROM stock_transfers WHERE id = $1 AND business_id = $2`,
      [params.id, tenant.businessId]
    );

    if (transferResult.rows.length === 0) {
      return NextResponse.json(
        { error: 'Transfer not found' },
        { status: 404 }
      );
    }

    const transfer = transferResult.rows[0];

    // CRITICAL: Enforce subscription feature access
    try {
      await assertFeatureAccess(transfer.business_id, 'multi_warehouse');
    } catch (error) {
      if (error instanceof FeatureAccessDeniedError) {
        return error.toNextResponse();
      }
      throw error;
    }

    // AUTHORIZATION: Check approve permission (PBAC will check source/destination warehouse access, status validation)
    try {
      await authorize(userId, 'warehouse_transfer', 'approve', {
        businessId: transfer.business_id,
        resourceId: params.id,
        sourceWarehouseId: transfer.from_location_id,
        destinationWarehouseId: transfer.to_location_id,
        status: transfer.status,
        resource: transfer,
      });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    // Validate status
    if (transfer.status !== 'draft' && transfer.status !== 'pending_approval') {
      return NextResponse.json(
        { error: `Cannot approve transfer in ${transfer.status} status. Only draft or pending_approval transfers can be approved.` },
        { status: 400 }
      );
    }

    const fromBranch = await client.query(
      `SELECT COALESCE(
         w.branch_id,
         (SELECT bw.branch_id FROM branch_warehouses bw WHERE bw.warehouse_id = w.id
           ORDER BY bw.is_primary DESC NULLS LAST LIMIT 1)
       ) AS branch_id
         FROM warehouses w WHERE w.id = $1 AND w.business_id = $2`,
      [transfer.from_location_id, tenant.businessId]
    );
    const guard = await periodGuardResponse({
      businessId: tenant.businessId,
      branchId: fromBranch.rows[0]?.branch_id ?? null,
      dates: [transfer.transfer_date],
      action: 'approve this stock transfer',
      checkGstFiled: true,
    });
    if (guard) return guard;

    await client.query('BEGIN');

    const locked = await client.query(
      `SELECT status FROM stock_transfers WHERE id = $1 AND business_id = $2 FOR UPDATE`,
      [params.id, tenant.businessId]
    );
    const lockedStatus = locked.rows[0]?.status;
    if (lockedStatus !== 'draft' && lockedStatus !== 'pending_approval') {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: `Transfer is ${lockedStatus ?? 'missing'}; it can no longer be approved.`, code: 'TRANSFER_STATE_CHANGED' },
        { status: 409 }
      );
    }
    await client.query(`
      UPDATE stock_transfers 
      SET status = 'pending',
          approved_by = $1,
          approved_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP,
          notes = CASE 
            WHEN $2::text IS NOT NULL AND notes IS NOT NULL THEN notes || E'\n' || 'Approved: ' || $2::text
            WHEN $2::text IS NOT NULL THEN 'Approved: ' || $2::text
            WHEN notes IS NOT NULL THEN notes || E'\n' || 'Approved'
            ELSE 'Approved'
          END
      WHERE id = $3
    `, [userId, approval_notes || null, params.id]);

    await ensureInterBranchInvoiceForTransfer(client, params.id, {
      ewayBillNumber: body.eway_bill_number,
      ewayBillDate: body.eway_bill_date,
      createdBy: userId,
    });

    await client.query('COMMIT');

    // Fetch updated transfer with warehouse names
    const finalTransfer = await queryOne(`
      SELECT 
        st.*,
        fw.name as from_warehouse_name,
        tw.name as to_warehouse_name,
        u.name as approved_by_name
      FROM stock_transfers st
      LEFT JOIN warehouses fw ON st.from_location_id = fw.id
      LEFT JOIN warehouses tw ON st.to_location_id = tw.id
      LEFT JOIN users u ON st.approved_by = u.id
      WHERE st.id = $1
    `, [params.id]);

    return NextResponse.json({ 
      success: true,
      transfer: finalTransfer
    });
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('Error approving stock transfer:', error);
    return NextResponse.json(
      { error: 'Failed to approve stock transfer', details: error.message },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}
