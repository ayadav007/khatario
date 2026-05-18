import { NextRequest, NextResponse } from 'next/server';
import { getPool, queryOne } from '@/lib/db';
import { assertFeatureAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { authorize, AuthorizationError } from '@/lib/authorization';

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
    const { approved_by, approval_notes } = body;

    const userId = approved_by || body.user_id; // REQUIRED for authorization
    if (!userId) {
      client.release();
      return NextResponse.json(
        { error: 'approved_by (user_id) is required for authorization' },
        { status: 400 }
      );
    }

    // Get transfer with lock
    const transferResult = await client.query(`
      SELECT * FROM stock_transfers WHERE id = $1 FOR UPDATE
    `, [params.id]);

    if (transferResult.rows.length === 0) {
      client.release();
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
      client.release();
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
      client.release();
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    // Validate status
    if (transfer.status !== 'draft' && transfer.status !== 'pending_approval') {
      client.release();
      return NextResponse.json(
        { error: `Cannot approve transfer in ${transfer.status} status. Only draft or pending_approval transfers can be approved.` },
        { status: 400 }
      );
    }

    await client.query('BEGIN');

    // Update transfer status to 'pending' (approved and ready for dispatch)
    const updatedTransfer = await queryOne(`
      UPDATE stock_transfers 
      SET status = 'pending',
          approved_by = $1,
          approved_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP,
          notes = CASE 
            WHEN $2 IS NOT NULL AND notes IS NOT NULL THEN notes || E'\n' || 'Approved: ' || $2
            WHEN $2 IS NOT NULL THEN 'Approved: ' || $2
            WHEN notes IS NOT NULL THEN notes || E'\n' || 'Approved'
            ELSE 'Approved'
          END
      WHERE id = $3
      RETURNING *
    `, [userId, approval_notes || null, params.id]);

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
