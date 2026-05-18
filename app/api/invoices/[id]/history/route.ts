import { NextRequest, NextResponse } from 'next/server';
import { queryOne, queryRows } from '@/lib/db';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { getSessionScopedBusinessId, getUserIdFromRequest } from '@/lib/auth-helpers';

export interface ActivityLogRow {
  id: string;
  action_type: string;
  module: string;
  entity_id: string | null;
  entity_type: string | null;
  description: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
  user_name: string | null;
  user_email: string | null;
}

/**
 * GET /api/invoices/[id]/history
 * Activity log for this invoice (module = invoices).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const invoiceId = params.id;
    const userId = getUserIdFromRequest(request);

    if (!userId) {
      return NextResponse.json(
        { error: 'user_id is required for authorization' },
        { status: 400 }
      );
    }

    const businessScope = getSessionScopedBusinessId(request);
    if (!businessScope) {
      return NextResponse.json({ error: 'business_id is required' }, { status: 400 });
    }

    const invoice = await queryOne<{ id: string; business_id: string; branch_id: string | null }>(
      'SELECT id, business_id, branch_id FROM invoices WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL',
      [invoiceId, businessScope]
    );
    if (!invoice) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
    }

    try {
      await authorize(userId, 'invoices', 'read', {
        businessId: invoice.business_id,
        branchId: invoice.branch_id ?? undefined,
        resourceId: invoiceId,
      });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    const { searchParams } = new URL(request.url);
    const limitParam = Number(searchParams.get('limit') ?? '100');
    const limit = Math.min(Math.max(limitParam, 1), 500);

    const rows = await queryRows<ActivityLogRow>(
      `
      SELECT
        al.id,
        al.action_type,
        al.module,
        al.entity_id,
        al.entity_type,
        al.description,
        al.metadata,
        al.created_at,
        u.name AS user_name,
        u.email AS user_email
      FROM activity_logs al
      LEFT JOIN users u ON u.id = al.user_id
      WHERE al.business_id = $1
        AND al.module = 'invoices'
        AND al.entity_id = $2
      ORDER BY al.created_at DESC
      LIMIT $3
      `,
      [invoice.business_id, invoiceId, limit]
    );

    return NextResponse.json({ history: rows });
  } catch (error: any) {
    console.error('Error fetching invoice history', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
