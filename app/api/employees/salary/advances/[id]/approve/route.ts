import { NextRequest, NextResponse } from 'next/server';
import { queryOne, query } from '@/lib/db';
import { SalaryAdvance } from '@/types/database';
import { authorize, AuthorizationError } from '@/lib/authorization';

/**
 * PATCH /api/employees/salary/advances/[id]/approve
 * Approve or reject a salary advance
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const advanceId = params.id;
    const { searchParams } = new URL(request.url);
    const businessId = searchParams.get('business_id');
    const body = await request.json();
    const { approved, approved_by, rejection_reason, payment_mode, payment_reference } = body;

    if (!businessId) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    if (!approved_by) {
      return NextResponse.json(
        { error: 'approved_by (user_id) is required for authorization' },
        { status: 400 }
      );
    }

    // Verify advance belongs to business
    const existing = await queryOne<SalaryAdvance>(
      'SELECT * FROM salary_advances WHERE id = $1 AND business_id = $2',
      [advanceId, businessId]
    );

    if (!existing) {
      return NextResponse.json(
        { error: 'Advance not found' },
        { status: 404 }
      );
    }

    // AUTHORIZATION: Check update permission (approving/rejecting advances is part of HR/payroll module)
    try {
      await authorize(approved_by, 'payroll', 'update', { businessId, resourceId: advanceId });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    if (existing.status !== 'pending') {
      return NextResponse.json(
        { error: `Advance is already ${existing.status}` },
        { status: 400 }
      );
    }

    if (approved) {
      // Approve advance
      const updated = await queryOne<SalaryAdvance>(
        `UPDATE salary_advances
         SET status = 'approved',
             approved_by = $1,
             approved_at = CURRENT_TIMESTAMP,
             payment_mode = $2,
             payment_reference = $3,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $4
         RETURNING *`,
        [
          approved_by || null,
          payment_mode || null,
          payment_reference || null,
          advanceId,
        ]
      );

      return NextResponse.json({ advance: updated });
    } else {
      // Reject advance
      if (!rejection_reason) {
        return NextResponse.json(
          { error: 'rejection_reason is required when rejecting' },
          { status: 400 }
        );
      }

      const updated = await queryOne<SalaryAdvance>(
        `UPDATE salary_advances
         SET status = 'rejected',
             approved_by = $1,
             approved_at = CURRENT_TIMESTAMP,
             rejection_reason = $2,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $3
         RETURNING *`,
        [approved_by || null, rejection_reason, advanceId]
      );

      return NextResponse.json({ advance: updated });
    }
  } catch (error: any) {
    console.error('Error approving/rejecting advance:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

