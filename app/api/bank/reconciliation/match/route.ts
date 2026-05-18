import { NextRequest, NextResponse } from 'next/server';
import {
  getUserIdFromRequest,
  getBusinessIdFromRequest,
  resolveCreatedByUserId,
} from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { queryOne, query } from '@/lib/db';
import { isBankStatementReconciliationCompleted } from '@/lib/bank/statement-workflow';

export const dynamic = 'force-dynamic';

/**
 * POST /api/bank/reconciliation/match
 * Body: business_id, bank_statement_id, statement_line_id, ledger_line_ids: string[]
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
    const ledgerIds = body.ledger_line_ids as string[];

    if (!statementId || !lineId || !Array.isArray(ledgerIds) || ledgerIds.length === 0) {
      return NextResponse.json(
        { error: 'bank_statement_id, statement_line_id, and ledger_line_ids are required' },
        { status: 400 }
      );
    }

    if (await isBankStatementReconciliationCompleted(businessId, statementId)) {
      return NextResponse.json(
        { error: 'Statement is marked reconciled; undo a match first to edit.' },
        { status: 409 }
      );
    }

    const line = await queryOne<{ id: string; bank_statement_id: string }>(
      `SELECT id, bank_statement_id FROM bank_statement_lines
       WHERE id = $1 AND business_id = $2 AND bank_statement_id = $3`,
      [lineId, businessId, statementId]
    );
    if (!line) {
      return NextResponse.json({ error: 'Statement line not found' }, { status: 404 });
    }

    const status = ledgerIds.length > 1 ? 'partial' : 'matched';
    const primary = ledgerIds[0]!;

    await query(
      `UPDATE bank_statement_lines SET
         match_status = $1,
         matched_ledger_ids = $2::jsonb,
         is_matched = true,
         matched_ledger_entry_id = $3::uuid,
         match_type = 'manual',
         matched_at = CURRENT_TIMESTAMP,
         matched_by = $4::uuid
       WHERE id = $5 AND business_id = $6`,
      [status, JSON.stringify(ledgerIds), primary, userId, lineId, businessId]
    );

    return NextResponse.json({ ok: true, match_status: status, matched_ledger_ids: ledgerIds });
  } catch (error: any) {
    console.error('bank reconciliation match error:', error);
    return NextResponse.json(
      { error: error?.message || 'Failed to save match' },
      { status: 500 }
    );
  }
}
