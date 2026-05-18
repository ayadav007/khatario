import { NextRequest, NextResponse } from 'next/server';
import { queryRows } from '@/lib/db';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';

/**
 * GET /api/dashboard/today-purchases
 * Get purchases made today (same logic as dashboard)
 */
export async function GET(request: NextRequest) {
  try {
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);

    if (!userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    try {
      await authorize(userId, 'dashboard', 'read');
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    if (!businessId) {
      return NextResponse.json(
        { error: 'Business ID is required' },
        { status: 400 }
      );
    }

    // Use the same SQL logic as dashboard overview
    const purchases = await queryRows(
      `SELECT 
        p.*,
        s.name as supplier_name,
        s.phone as supplier_phone
      FROM purchases p
      LEFT JOIN suppliers s ON p.supplier_id = s.id
      WHERE p.business_id = $1 
        AND p.deleted_at IS NULL
        AND p.bill_date = CURRENT_DATE 
        AND p.status != 'cancelled'
      ORDER BY p.bill_date DESC, p.created_at DESC`,
      [businessId]
    );

    return NextResponse.json({ purchases });
  } catch (error: any) {
    console.error('Error fetching today purchases:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    );
  }
}

