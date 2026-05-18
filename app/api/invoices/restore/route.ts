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
 * POST /api/invoices/restore
 * Clears deleted_at on a soft-deleted invoice (same business scope only).
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
    invoice_date: string | null;
  }>(
    `SELECT id, business_id, branch_id, deleted_at, invoice_date::text AS invoice_date
     FROM invoices
     WHERE id = $1 AND business_id = $2`,
    [id, businessScope]
  );

  if (!row?.deleted_at) {
    return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
  }

  try {
    await authorize(userId, 'invoices', 'update', {
      branchId: row.branch_id ?? undefined,
      businessId: row.business_id,
      resourceId: id,
      invoice_date: row.invoice_date ?? undefined,
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
    `UPDATE invoices
     SET deleted_at = NULL, updated_at = CURRENT_TIMESTAMP
     WHERE id = $1 AND business_id = $2 AND deleted_at IS NOT NULL
     RETURNING id`,
    [id, businessScope]
  );

  if (upd.rowCount === 0) {
    return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
