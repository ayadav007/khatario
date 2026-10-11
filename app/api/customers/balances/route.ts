import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { getAuthenticatedUserId, getSessionScopedBusinessId } from '@/lib/auth-helpers';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * GET /api/customers/balances?ids=uuid,uuid
 * Live receivable balances for the invoice customer list. Session tenant only.
 */
export async function GET(request: NextRequest) {
  const businessId = getSessionScopedBusinessId(request);
  const userId = getAuthenticatedUserId(request);
  if (!businessId || !userId) {
    return NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 });
  }
  try {
    await authorize(userId, 'customers', 'read', { businessId });
  } catch (error) {
    if (error instanceof AuthorizationError) return error.toNextResponse();
    throw error;
  }

  const ids = [...new Set(
    (request.nextUrl.searchParams.get('ids') || '')
      .split(',')
      .map((id) => id.trim())
      .filter((id) => UUID_RE.test(id))
  )].slice(0, 50);
  if (ids.length === 0) {
    return NextResponse.json({ customers: [] });
  }

  const pool = getPool();
  const rows = await pool.query<{ id: string; current_balance: string }>(
    `SELECT id, current_balance
       FROM customers
      WHERE business_id = $1 AND deleted_at IS NULL AND id = ANY($2::uuid[])`,
    [businessId, ids]
  );
  return NextResponse.json({
    customers: rows.rows.map((row) => ({
      id: row.id,
      current_balance: Number(row.current_balance) || 0,
    })),
  });
}
