import { NextRequest, NextResponse } from 'next/server';
import { queryOne, query } from '@/lib/db';
import { EmployeeTarget } from '@/types/database';

/**
 * DELETE /api/employees/targets/[id]
 * Delete an employee target
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const targetId = params.id;
    const { searchParams } = new URL(request.url);
    const businessId = searchParams.get('business_id');

    if (!businessId) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    // Verify target belongs to business
    const existing = await queryOne(
      `SELECT et.id FROM employee_targets et
       INNER JOIN employees e ON et.employee_id = e.id
       WHERE et.id = $1 AND e.business_id = $2`,
      [targetId, businessId]
    );

    if (!existing) {
      return NextResponse.json(
        { error: 'Target not found' },
        { status: 404 }
      );
    }

    await query('DELETE FROM employee_targets WHERE id = $1', [targetId]);

    return NextResponse.json({ message: 'Target deleted successfully' });
  } catch (error: any) {
    console.error('Error deleting target:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

