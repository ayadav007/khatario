import { NextRequest, NextResponse } from 'next/server';
import { queryOne, query } from '@/lib/db';
import { Shift } from '@/types/database';

/**
 * PATCH /api/shifts/[id]
 * Update a shift
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const shiftId = params.id;
    const { searchParams } = new URL(request.url);
    const businessId = searchParams.get('business_id');
    const body = await request.json();

    if (!businessId) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    // Verify shift belongs to business
    const existing = await queryOne(
      'SELECT id FROM shifts WHERE id = $1 AND business_id = $2',
      [shiftId, businessId]
    );

    if (!existing) {
      return NextResponse.json(
        { error: 'Shift not found' },
        { status: 404 }
      );
    }

    const {
      shift_name,
      start_time,
      end_time,
      break_duration,
      is_active,
    } = body;

    const updates: string[] = [];
    const queryParams: any[] = [];
    let paramIndex = 1;

    if (shift_name !== undefined) {
      updates.push(`shift_name = $${paramIndex++}`);
      queryParams.push(shift_name);
    }
    if (start_time !== undefined) {
      updates.push(`start_time = $${paramIndex++}`);
      queryParams.push(start_time);
    }
    if (end_time !== undefined) {
      updates.push(`end_time = $${paramIndex++}`);
      queryParams.push(end_time);
    }
    if (break_duration !== undefined) {
      updates.push(`break_duration = $${paramIndex++}`);
      queryParams.push(break_duration);
    }
    if (is_active !== undefined) {
      updates.push(`is_active = $${paramIndex++}`);
      queryParams.push(is_active);
    }

    if (updates.length > 0) {
      queryParams.push(shiftId);
      await query(
        `UPDATE shifts SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = $${paramIndex}`,
        queryParams
      );
    }

    const updatedShift = await queryOne<Shift>(
      'SELECT * FROM shifts WHERE id = $1',
      [shiftId]
    );

    return NextResponse.json({ shift: updatedShift });
  } catch (error: any) {
    console.error('Error updating shift:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/shifts/[id]
 * Delete a shift (soft delete by setting is_active = false)
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const shiftId = params.id;
    const { searchParams } = new URL(request.url);
    const businessId = searchParams.get('business_id');

    if (!businessId) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    // Verify shift belongs to business
    const existing = await queryOne(
      'SELECT id FROM shifts WHERE id = $1 AND business_id = $2',
      [shiftId, businessId]
    );

    if (!existing) {
      return NextResponse.json(
        { error: 'Shift not found' },
        { status: 404 }
      );
    }

    // Soft delete
    await query(
      'UPDATE shifts SET is_active = false WHERE id = $1',
      [shiftId]
    );

    return NextResponse.json({ message: 'Shift deleted successfully' });
  } catch (error: any) {
    console.error('Error deleting shift:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

