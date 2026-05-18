import { NextRequest, NextResponse } from 'next/server';
import * as db from '@/lib/db';
import { format } from 'date-fns';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';

/**
 * GET /api/invoices/for-reminders?business_id=xxx&payment_status=both&search=xxx&date_from=xxx&date_to=xxx
 * Fetch invoices eligible for manual reminders
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request); // REQUIRED for authorization
    const paymentStatus = searchParams.get('payment_status') || 'both'; // 'unpaid', 'partially_paid', 'both'
    const search = searchParams.get('search') || '';
    const dateFrom = searchParams.get('date_from');
    const dateTo = searchParams.get('date_to');

    if (!businessId) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    if (!userId) {
      return NextResponse.json(
        { error: 'user_id is required for authorization' },
        { status: 400 }
      );
    }

    // AUTHORIZATION: Check read permission
    try {
      await authorize(userId, 'invoices', 'read');
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    // Get user's accessible branch IDs
    let accessibleBranchIds: string[] = [];
    try {
      const { getUserAccessibleBranchIds } = await import('@/lib/branch-access');
      accessibleBranchIds = await getUserAccessibleBranchIds(userId);
    } catch (error) {
      console.error('Error fetching user accessible branches:', error);
      // If error, return empty result to be safe
      return NextResponse.json({ invoices: [] });
    }

    let sql = `
      SELECT 
        i.id,
        i.invoice_number,
        i.invoice_date,
        i.due_date,
        i.payment_status,
        i.grand_total,
        i.balance_amount,
        i.status as invoice_status,
        c.id as customer_id,
        c.name as customer_name,
        c.phone as customer_phone,
        c.email as customer_email
      FROM invoices i
      LEFT JOIN customers c ON c.id = i.customer_id AND c.deleted_at IS NULL
      WHERE i.business_id = $1
        AND i.deleted_at IS NULL
        AND i.status = 'final'
        AND i.payment_status IN ('unpaid', 'partially_paid')
        AND (c.phone IS NOT NULL AND c.phone != '')
    `;
    const params: any[] = [businessId];
    let paramIndex = 2;

    // Filter by user's accessible branches
    if (accessibleBranchIds.length > 0) {
      sql += ` AND i.branch_id = ANY($${paramIndex}::uuid[])`;
      params.push(accessibleBranchIds);
      paramIndex++;
    } else {
      // User has no branch access - return empty result
      return NextResponse.json({ invoices: [] });
    }

    // Add payment status filter
    if (paymentStatus === 'unpaid') {
      sql += ` AND i.payment_status = 'unpaid'`;
    } else if (paymentStatus === 'partially_paid') {
      sql += ` AND i.payment_status = 'partially_paid'`;
    }
    // 'both' means no additional filter

    // Add search filter (invoice number or customer name)
    if (search) {
      sql += ` AND (i.invoice_number ILIKE $${paramIndex} OR c.name ILIKE $${paramIndex})`;
      params.push(`%${search}%`);
      paramIndex++;
    }

    // Add date range filter
    if (dateFrom) {
      sql += ` AND i.invoice_date >= $${paramIndex}`;
      params.push(dateFrom);
      paramIndex++;
    }
    if (dateTo) {
      sql += ` AND i.invoice_date <= $${paramIndex}`;
      params.push(dateTo);
      paramIndex++;
    }

    sql += ` ORDER BY i.due_date ASC, i.invoice_date DESC LIMIT 500`;

    const invoices = await db.queryRows(sql, params);

    // Format the response
    const formattedInvoices = invoices.map((inv: any) => ({
      id: inv.id,
      invoice_number: inv.invoice_number,
      invoice_date: inv.invoice_date,
      due_date: inv.due_date,
      payment_status: inv.payment_status,
      grand_total: parseFloat(inv.grand_total || 0),
      balance_amount: parseFloat(inv.balance_amount || 0),
      status: inv.invoice_status,
      customer: {
        id: inv.customer_id,
        name: inv.customer_name || 'Cash Sale',
        phone: inv.customer_phone,
        email: inv.customer_email
      }
    }));

    return NextResponse.json({ invoices: formattedInvoices });
  } catch (error: any) {
    console.error('Error fetching invoices for reminders:', error);
    return NextResponse.json(
      { error: 'Failed to fetch invoices', details: error.message },
      { status: 500 }
    );
  }
}

