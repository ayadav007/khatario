import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { getAuthenticatedUserId, getSessionScopedBusinessId } from '@/lib/auth-helpers';
import { parseEwayBillDate, parseEwayBillNumber } from '@/lib/gst/eway';

export const dynamic = 'force-dynamic';

/**
 * PATCH /api/invoices/[id]/eway
 * Save or clear the e-way bill number after the invoice is final.
 * Does not change amounts, stock, or ledger lines.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const userId = getAuthenticatedUserId(request);
    const businessId = getSessionScopedBusinessId(request);
    if (!userId || !businessId) {
      return NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const number = parseEwayBillNumber(body.eway_bill_number);
    if (number.error) {
      return NextResponse.json({ error: number.error, code: 'INVALID_EWAY' }, { status: 400 });
    }
    const date = parseEwayBillDate(body.eway_bill_date);
    if (date.error) {
      return NextResponse.json({ error: date.error, code: 'INVALID_EWAY_DATE' }, { status: 400 });
    }

    const pool = getPool();
    const existing = await pool.query<{ id: string; branch_id: string | null; status: string }>(
      `SELECT id, branch_id, status FROM invoices
        WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL`,
      [params.id, businessId],
    );
    if (existing.rows.length === 0) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
    }
    if (existing.rows[0].status === 'cancelled') {
      return NextResponse.json({ error: 'A cancelled invoice cannot take an e-way bill number' }, { status: 409 });
    }

    try {
      await authorize(userId, 'invoices', 'update', {
        businessId,
        branchId: existing.rows[0].branch_id || undefined,
        resourceId: params.id,
      });
    } catch (error) {
      if (error instanceof AuthorizationError) return error.toNextResponse();
      throw error;
    }

    const updated = await pool.query(
      `UPDATE invoices
          SET eway_bill_number = $3,
              eway_bill_date = $4,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL
        RETURNING id, eway_bill_number, eway_bill_date`,
      [params.id, businessId, number.number, date.date],
    );

    return NextResponse.json({ invoice: updated.rows[0] });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error saving e-way bill number:', error);
    return NextResponse.json({ error: 'Failed to save e-way bill number', details: message }, { status: 500 });
  }
}
