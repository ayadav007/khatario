import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import { queryRows } from '@/lib/db';
import { authorize, AuthorizationError } from '@/lib/authorization';

/**
 * GET /api/credit-approvals/pending
 * List all pending credit approvals for a business
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);

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

    // AUTHORIZATION: Check read permission for invoices (to view approvals)
    try {
      await authorize(userId, 'invoices', 'read', { businessId });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    // Fetch pending approvals with entity and reference details
    const approvals = await queryRows(`
      SELECT 
        ca.*,
        CASE 
          WHEN ca.entity_type = 'customer' THEN c.name
          WHEN ca.entity_type = 'supplier' THEN s.name
        END as entity_name,
        CASE 
          WHEN ca.reference_type = 'invoice' THEN i.invoice_number
          WHEN ca.reference_type = 'purchase' THEN p.bill_number
        END as reference_number,
        CASE 
          WHEN ca.reference_type = 'invoice' THEN i.grand_total
          WHEN ca.reference_type = 'purchase' THEN p.grand_total
        END as reference_amount,
        u1.name as requested_by_name,
        u2.name as approved_by_name
      FROM credit_approvals ca
      LEFT JOIN customers c ON ca.entity_type = 'customer' AND ca.entity_id = c.id
      LEFT JOIN suppliers s ON ca.entity_type = 'supplier' AND ca.entity_id = s.id
      LEFT JOIN invoices i ON ca.reference_type = 'invoice' AND ca.reference_id = i.id
      LEFT JOIN purchases p ON ca.reference_type = 'purchase' AND ca.reference_id = p.id
      LEFT JOIN users u1 ON ca.requested_by = u1.id
      LEFT JOIN users u2 ON ca.approved_by = u2.id
      WHERE ca.business_id = $1 AND ca.status = 'pending'
      ORDER BY ca.created_at DESC
    `, [businessId]);

    return NextResponse.json({ approvals });
  } catch (error: any) {
    console.error('Error fetching pending approvals:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch pending approvals' },
      { status: 500 }
    );
  }
}
