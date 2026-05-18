import { NextRequest, NextResponse } from 'next/server';
import { queryRows } from '@/lib/db';

/**
 * GET /api/todos/users?business_id=xxx
 * Get list of users/employees for todo assignment
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = searchParams.get('business_id');

    if (!businessId) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    // Fetch active users for the business (including employees)
    const users = await queryRows(
      `SELECT 
        u.id,
        u.name,
        u.email,
        u.phone,
        e.employee_code,
        e.designation,
        CASE 
          WHEN e.employee_code IS NOT NULL THEN CONCAT(u.name, ' (', e.employee_code, ')')
          ELSE u.name
        END as display_name
       FROM users u
       LEFT JOIN employees e ON u.id = e.id
       WHERE u.business_id = $1 AND u.is_active = true
       ORDER BY u.name ASC`,
      [businessId]
    );

    return NextResponse.json({ users });
  } catch (error: any) {
    console.error('Error fetching users for todo assignment:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
