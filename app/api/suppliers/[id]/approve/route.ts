import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { assertFeatureAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { Supplier } from '@/types/database';

/**
 * Approve or reject a supplier relationship request
 * POST /api/suppliers/:id/approve
 * Body: { action: 'approve' | 'reject', rejection_reason?: string }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supplierId = params.id;
    const body = await request.json();
    const { action, rejection_reason } = body;

    if (!action || !['approve', 'reject'].includes(action)) {
      return NextResponse.json(
        { error: 'Invalid action. Must be "approve" or "reject"' },
        { status: 400 }
      );
    }

    // Fetch the supplier record
    const supplier = await queryOne<Pick<Supplier, 'id' | 'business_id' | 'name' | 'linked_business_id' | 'approval_status' | 'requested_by_business_id'>>(
      `SELECT 
        id, business_id, name, linked_business_id, 
        approval_status, requested_by_business_id
      FROM suppliers 
      WHERE id = $1 AND deleted_at IS NULL`,
      [supplierId]
    );

    if (!supplier) {
      return NextResponse.json(
        { error: 'Supplier not found' },
        { status: 404 }
      );
    }

    // Verify that the linked_business_id matches the business taking action
    // (Only the linked business can approve/reject)
    const { searchParams } = new URL(request.url);
    const businessId = searchParams.get('business_id');

    if (!businessId) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    if (supplier.linked_business_id !== businessId) {
      return NextResponse.json(
        { error: 'Unauthorized. Only the linked business can approve/reject this request' },
        { status: 403 }
      );
    }

    // CRITICAL: Enforce subscription feature access
    try {
      await assertFeatureAccess(businessId, 'supplier_management');
    } catch (error) {
      if (error instanceof FeatureAccessDeniedError) {
        return error.toNextResponse();
      }
      throw error;
    }

    if (supplier.approval_status !== 'pending') {
      return NextResponse.json(
        { error: `Cannot ${action} - supplier status is already ${supplier.approval_status}` },
        { status: 400 }
      );
    }

    // Update supplier record
    const now = new Date();
    let updateQuery = '';
    let updateParams: any[] = [];

    if (action === 'approve') {
      updateQuery = `
        UPDATE suppliers 
        SET approval_status = 'approved',
            approved_at = $1,
            updated_at = $1
        WHERE id = $2
        RETURNING *
      `;
      updateParams = [now, supplierId];
    } else {
      updateQuery = `
        UPDATE suppliers 
        SET approval_status = 'rejected',
            rejected_at = $1,
            rejection_reason = $2,
            updated_at = $1
        WHERE id = $3
        RETURNING *
      `;
      updateParams = [now, rejection_reason || 'No reason provided', supplierId];
    }

    const updatedSupplier = await queryOne<Supplier>(updateQuery, updateParams);

    // Create notification for the requester
    const notificationTitle = action === 'approve' 
      ? '✓ Supplier Request Approved'
      : '✗ Supplier Request Rejected';
    
    const notificationMessage = action === 'approve'
      ? `${supplier.name} has approved your supplier relationship request. You can now track their inventory and set stock thresholds.`
      : `${supplier.name} has declined your supplier relationship request. ${rejection_reason ? `Reason: ${rejection_reason}` : ''}`;

    await query(
      `INSERT INTO notifications (
        business_id, type, title, message, 
        reference_type, reference_id, created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        supplier.requested_by_business_id,
        action === 'approve' ? 'supplier_approved' : 'supplier_rejected',
        notificationTitle,
        notificationMessage,
        'supplier',
        supplierId,
        now
      ]
    );

    return NextResponse.json({
      success: true,
      action,
      supplier: updatedSupplier,
      message: `Supplier relationship ${action}d successfully`
    });

  } catch (error: any) {
    console.error('Error approving/rejecting supplier:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to process supplier approval' },
      { status: 500 }
    );
  }
}

