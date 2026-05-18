import { NextRequest, NextResponse } from 'next/server';
import { getPool, queryOne } from '@/lib/db';
import { authorize, AuthorizationError } from '@/lib/authorization';
import {
  getBusinessIdFromRequest,
  getSessionScopedBusinessId,
  getUserIdFromRequest,
} from '@/lib/auth-helpers';
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

  const userId = getUserIdFromRequest(request, body);
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const businessScope =
    getSessionScopedBusinessId(request) ?? getBusinessIdFromRequest(request, body);
  if (!businessScope) {
    return NextResponse.json({ error: 'business_id is required' }, { status: 400 });
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
  const upd = await pool.query(
    `UPDATE payments
     SET deleted_at = NULL
     WHERE id = $1 AND business_id = $2 AND deleted_at IS NOT NULL
     RETURNING id`,
    [id, businessScope]
  );

  if (upd.rowCount === 0) {
    return NextResponse.json({ error: 'Payment not found' }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
