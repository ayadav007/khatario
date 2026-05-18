import { NextRequest, NextResponse } from 'next/server';
import { getBusinessIdFromRequest, resolveCreatedByUserId } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { queryOne, query } from '@/lib/db';
import { isBankStatementReconciliationCompleted } from '@/lib/bank/statement-workflow';

export const dynamic = 'force-dynamic';

/**
 * POST /api/bank/reconciliation/ignore
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

    if (await isBankStatementReconciliationCompleted(businessId, statementId)) {
      return NextResponse.json(
        { error: 'Statement is marked reconciled; undo a match first to edit.' },
        { status: 409 }
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
         match_status = 'ignored',
         matched_ledger_ids = '[]'::jsonb,
         is_matched = false,
         matched_ledger_entry_id = NULL,
         match_type = 'manual',
         matched_at = CURRENT_TIMESTAMP,
         matched_by = $1::uuid
       WHERE id = $2 AND business_id = $3`,
      [userId, lineId, businessId]
    );

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error('bank reconciliation ignore error:', error);
    return NextResponse.json(
      { error: error?.message || 'Failed to ignore line' },
      { status: 500 }
    );
  }
}
