import { NextRequest, NextResponse } from 'next/server';
import { getBusinessIdFromRequest, resolveCreatedByUserId } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { queryOne, query } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * POST /api/bank/reconciliation/complete
 * Body: business_id, bank_statement_id, force?: boolean
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const businessId = (body.business_id as string) || getBusinessIdFromRequest(request);
    const userId = resolveCreatedByUserId(request, body);
    if (!businessId || !userId) {
      return NextResponse.json({ error: 'business_id and user context are required' }, { status: 400 });
    }

    try {
      await authorize(userId, 'settings', 'update', { businessId });
    } catch (e) {
      if (e instanceof AuthorizationError) return e.toNextResponse();
      throw e;
    }

    const statementId = body.bank_statement_id as string;
    const force = body.force === true;
    if (!statementId) {
      return NextResponse.json({ error: 'bank_statement_id is required' }, { status: 400 });
    }

    const stmt = await queryOne<{ id: string }>(
      'SELECT id FROM bank_statements WHERE id = $1 AND business_id = $2',
      [statementId, businessId]
    );
    if (!stmt) {
      return NextResponse.json({ error: 'Statement not found' }, { status: 404 });
    }

    const pending = await queryOne<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM bank_statement_lines
       WHERE bank_statement_id = $1 AND business_id = $2 AND match_status = 'unmatched'`,
      [statementId, businessId]
    );
    const n = parseInt(pending?.c || '0', 10);
    if (n > 0 && !force) {
      return NextResponse.json(
        {
          error: `Cannot complete: ${n} unmatched line(s). Pass force: true to complete anyway.`,
          unmatched_count: n,
        },
        { status: 409 }
      );
    }

    await query(
      `UPDATE bank_statements SET
         reconciliation_status = 'completed',
         is_reconciled = true,
         reconciled_at = COALESCE(reconciled_at, CURRENT_TIMESTAMP),
         reconciled_by = $2::uuid
       WHERE id = $1 AND business_id = $3`,
      [statementId, userId, businessId]
    );

    return NextResponse.json({ ok: true, reconciliation_status: 'completed' });
  } catch (error: any) {
    console.error('bank reconciliation complete error:', error);
    return NextResponse.json(
      { error: error?.message || 'Failed to complete reconciliation' },
      { status: 500 }
    );
  }
}
