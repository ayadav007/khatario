export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getPool, queryOne } from '@/lib/db';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { getAuthenticatedUserId, getSessionScopedBusinessId } from '@/lib/auth-helpers';
import { paymentRestoreUnsafeError } from '@/lib/accounting/final-document-payment';
import { assertFeatureAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { FeatureKeys } from '@/lib/featureKeys';

type Body = { id?: string };

/**
 * POST /api/payments/restore
 * Clears deleted_at on a soft-deleted payment (same business scope only).
 */
export async function POST(request: NextRequest) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const id = typeof body.id === 'string' ? body.id.trim() : '';
  if (!id) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 });
  }

  const userId = getAuthenticatedUserId(request);
  const businessScope = getSessionScopedBusinessId(request);
  if (!userId || !businessScope) {
    return NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 });
  }

  const row = await queryOne<{
    id: string;
    business_id: string;
    branch_id: string | null;
    deleted_at: string | null;
  }>(
    `SELECT id, business_id, branch_id, deleted_at
     FROM payments
     WHERE id = $1 AND business_id = $2`,
    [id, businessScope]
  );

  if (!row?.deleted_at) {
    return NextResponse.json({ error: 'Payment not found' }, { status: 404 });
  }

  try {
    await authorize(userId, 'payments', 'update', {
      branchId: row.branch_id ?? undefined,
      businessId: row.business_id,
      resourceId: id,
    });
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return error.toNextResponse();
    }
    throw error;
  }

  try {
    await assertFeatureAccess(businessScope, FeatureKeys.SOFT_DELETE);
  } catch (error) {
    if (error instanceof FeatureAccessDeniedError) {
      return error.toNextResponse();
    }
    throw error;
  }

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const locked = await client.query<{ id: string }>(
      `SELECT id FROM payments WHERE id = $1 AND business_id = $2 AND deleted_at IS NOT NULL FOR UPDATE`,
      [id, businessScope]
    );
    if (locked.rowCount === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Payment not found' }, { status: 404 });
    }

    const activePosting = await client.query(
      `SELECT 1
         FROM ledger_entry_lines l
        WHERE l.business_id = $1
          AND l.voucher_type = 'payment'
          AND l.voucher_id = $2
          AND NOT EXISTS (SELECT 1 FROM ledger_entry_reversals r WHERE r.original_line_id = l.id)
          AND NOT EXISTS (SELECT 1 FROM ledger_entry_reversals r WHERE r.reversal_line_id = l.id)
        LIMIT 1`,
      [businessScope, id]
    );
    if (activePosting.rowCount === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json(paymentRestoreUnsafeError(), { status: 409 });
    }

    await client.query(
      `UPDATE payments SET deleted_at = NULL WHERE id = $1 AND business_id = $2 AND deleted_at IS NOT NULL`,
      [id, businessScope]
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }

  return NextResponse.json({ success: true });
}
