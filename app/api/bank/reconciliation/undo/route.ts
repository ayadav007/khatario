import { NextRequest, NextResponse } from 'next/server';
import { getBusinessIdFromRequest, resolveCreatedByUserId } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { queryOne, query } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * POST /api/bank/reconciliation/undo
 * Clears match / ignore and returns line to unmatched.
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
    const lineId = body.statement_line_id as string;
    if (!statementId || !lineId) {
      return NextResponse.json(
        { error: 'bank_statement_id and statement_line_id are required' },
        { status: 400 }
      );
    }

    const line = await queryOne<{ id: string }>(
      `SELECT id FROM bank_statement_lines
       WHERE id = $1 AND business_id = $2 AND bank_statement_id = $3`,
      [lineId, businessId, statementId]
    );
    if (!line) {
      return NextResponse.json({ error: 'Statement line not found' }, { status: 404 });
    }

    await query(
      `UPDATE bank_statement_lines SET
         match_status = 'unmatched',
         matched_ledger_ids = '[]'::jsonb,
         is_matched = false,
         matched_ledger_entry_id = NULL,
         match_type = NULL,
         matched_at = NULL,
         matched_by = NULL
       WHERE id = $1 AND business_id = $2`,
      [lineId, businessId]
    );

    await query(
      `UPDATE bank_statements SET
         reconciliation_status = 'in_progress',
         is_reconciled = false,
         reconciled_at = NULL
       WHERE id = $1 AND business_id = $2`,
      [statementId, businessId]
    );

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error('bank reconciliation undo error:', error);
    return NextResponse.json(
      { error: error?.message || 'Failed to undo' },
      { status: 500 }
    );
  }
}
