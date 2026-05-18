import { NextRequest, NextResponse } from 'next/server';
import { queryOne, query } from '@/lib/db';
import { LeaveType } from '@/types/database';

/**
 * PATCH /api/leave-types/[id]
 * Update a leave type
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const leaveTypeId = params.id;
    const { searchParams } = new URL(request.url);
    const businessId = searchParams.get('business_id');
    const body = await request.json();

    if (!businessId) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    // Verify leave type belongs to business
    const existing = await queryOne(
      'SELECT id FROM leave_types WHERE id = $1 AND business_id = $2',
      [leaveTypeId, businessId]
    );

    if (!existing) {
      return NextResponse.json(
        { error: 'Leave type not found' },
        { status: 404 }
      );
    }

    const {
      leave_name,
      leave_code,
      max_days_per_year,
      carry_forward,
      max_carry_forward_days,
      requires_approval,
      is_paid,
      is_active,
      description,
    } = body;

    const updates: string[] = [];
    const queryParams: any[] = [];
    let paramIndex = 1;

    if (leave_name !== undefined) {
      updates.push(`leave_name = $${paramIndex++}`);
      queryParams.push(leave_name);
    }
    if (leave_code !== undefined) {
      updates.push(`leave_code = $${paramIndex++}`);
      queryParams.push(leave_code.toUpperCase());
    }
    if (max_days_per_year !== undefined) {
      updates.push(`max_days_per_year = $${paramIndex++}`);
      queryParams.push(max_days_per_year || null);
    }
    if (carry_forward !== undefined) {
      updates.push(`carry_forward = $${paramIndex++}`);
      queryParams.push(carry_forward);
    }
    if (max_carry_forward_days !== undefined) {
      updates.push(`max_carry_forward_days = $${paramIndex++}`);
      queryParams.push(max_carry_forward_days || null);
    }
    if (requires_approval !== undefined) {
      updates.push(`requires_approval = $${paramIndex++}`);
      queryParams.push(requires_approval);
    }
    if (is_paid !== undefined) {
      updates.push(`is_paid = $${paramIndex++}`);
      queryParams.push(is_paid);
    }
    if (is_active !== undefined) {
      updates.push(`is_active = $${paramIndex++}`);
      queryParams.push(is_active);
    }
    if (description !== undefined) {
      updates.push(`description = $${paramIndex++}`);
      queryParams.push(description || null);
    }

    if (updates.length > 0) {
      queryParams.push(leaveTypeId);
      await query(
        `UPDATE leave_types SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = $${paramIndex}`,
        queryParams
      );
    }

    const updatedLeaveType = await queryOne<LeaveType>(
      'SELECT * FROM leave_types WHERE id = $1',
      [leaveTypeId]
    );

    return NextResponse.json({ leave_type: updatedLeaveType });
  } catch (error: any) {
    console.error('Error updating leave type:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/leave-types/[id]
 * Delete a leave type (soft delete)
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const leaveTypeId = params.id;
    const { searchParams } = new URL(request.url);
    const businessId = searchParams.get('business_id');

    if (!businessId) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    // Verify leave type belongs to business
    const existing = await queryOne(
      'SELECT id FROM leave_types WHERE id = $1 AND business_id = $2',
      [leaveTypeId, businessId]
    );

    if (!existing) {
      return NextResponse.json(
        { error: 'Leave type not found' },
        { status: 404 }
      );
    }

    // Check if there are any leave requests using this type
    const hasRequests = await queryOne(
      'SELECT id FROM leave_requests WHERE leave_type_id = $1 LIMIT 1',
      [leaveTypeId]
    );

    if (hasRequests) {
      // Soft delete
      await query(
        'UPDATE leave_types SET is_active = false WHERE id = $1',
        [leaveTypeId]
      );
    } else {
      // Hard delete if no requests exist
      await query('DELETE FROM leave_types WHERE id = $1', [leaveTypeId]);
    }

    return NextResponse.json({ message: 'Leave type deleted successfully' });
  } catch (error: any) {
    console.error('Error deleting leave type:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

