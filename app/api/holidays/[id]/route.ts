import { NextRequest, NextResponse } from 'next/server';
import { queryOne, query } from '@/lib/db';
import { Holiday } from '@/types/database';

/**
 * PATCH /api/holidays/[id]
 * Update a holiday
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const holidayId = params.id;
    const { searchParams } = new URL(request.url);
    const businessId = searchParams.get('business_id');
    const body = await request.json();

    if (!businessId) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    const existing = await queryOne(
      'SELECT id FROM holidays WHERE id = $1 AND business_id = $2',
      [holidayId, businessId]
    );

    if (!existing) {
      return NextResponse.json(
        { error: 'Holiday not found' },
        { status: 404 }
      );
    }

    const { holiday_date, holiday_name, is_recurring, description } = body;

    const updates: string[] = [];
    const queryParams: any[] = [];
    let paramIndex = 1;

    if (holiday_date !== undefined) {
      updates.push(`holiday_date = $${paramIndex++}`);
      queryParams.push(holiday_date);
    }
    if (holiday_name !== undefined) {
      updates.push(`holiday_name = $${paramIndex++}`);
      queryParams.push(holiday_name);
    }
    if (is_recurring !== undefined) {
      updates.push(`is_recurring = $${paramIndex++}`);
      queryParams.push(is_recurring);
    }
    if (description !== undefined) {
      updates.push(`description = $${paramIndex++}`);
      queryParams.push(description || null);
    }

    if (updates.length > 0) {
      queryParams.push(holidayId);
      await query(
        `UPDATE holidays SET ${updates.join(', ')} WHERE id = $${paramIndex}`,
        queryParams
      );
    }

    const updated = await queryOne<Holiday>(
      'SELECT * FROM holidays WHERE id = $1',
      [holidayId]
    );

    return NextResponse.json({ holiday: updated });
  } catch (error: any) {
    console.error('Error updating holiday:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/holidays/[id]
 * Delete a holiday
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const holidayId = params.id;
    const { searchParams } = new URL(request.url);
    const businessId = searchParams.get('business_id');

    if (!businessId) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    const existing = await queryOne(
      'SELECT id FROM holidays WHERE id = $1 AND business_id = $2',
      [holidayId, businessId]
    );

    if (!existing) {
      return NextResponse.json(
        { error: 'Holiday not found' },
        { status: 404 }
      );
    }

    await query('DELETE FROM holidays WHERE id = $1', [holidayId]);

    return NextResponse.json({ message: 'Holiday deleted successfully' });
  } catch (error: any) {
    console.error('Error deleting holiday:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

