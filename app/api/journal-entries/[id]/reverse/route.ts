export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUserId, getSessionScopedBusinessId } from '@/lib/auth-helpers';
import { queryOne, queryRows, getPool } from '@/lib/db';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { periodGuardResponse, touchesGstAccounts } from '@/lib/http/period-guards';
import { reverseJournal } from '@/lib/accounting/journal-corrections';

/**
 * POST /api/journal-entries/[id]/reverse  { reason: string }  (or ?reason=)
 * Posts linked reversing lines for the journal's current posting. The journal stays visible as
 * reversed with its original lines; nothing is deleted.
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const voucherId = params.id;
  const userId = getAuthenticatedUserId(request);
  const businessId = getSessionScopedBusinessId(request);
  if (!userId || !businessId) {
    return NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 });
  }

  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const rawReason = typeof body.reason === 'string' ? body.reason : new URL(request.url).searchParams.get('reason');
  const reason = (rawReason || '').trim().slice(0, 450);
  if (!reason) {
    return NextResponse.json({ error: 'A reason is required to reverse a journal entry', code: 'REASON_REQUIRED' }, { status: 400 });
  }

  const journalEntry = await queryOne<{
    voucher_number: string | null;
    entry_date: string | Date;
    is_locked: boolean;
    branch_id: string | null;
    line_branch_id: string | null;
  }>(
    `SELECT je.*,
            (SELECT lel.branch_id FROM ledger_entry_lines lel
              WHERE lel.voucher_id = je.voucher_id AND lel.business_id = je.business_id
                AND lel.voucher_type = 'journal' AND lel.branch_id IS NOT NULL
              LIMIT 1) AS line_branch_id
       FROM journal_entries je
      WHERE je.voucher_id = $1 AND je.business_id = $2 AND je.deleted_at IS NULL`,
    [voucherId, businessId]
  );
  if (!journalEntry) {
    return NextResponse.json({ error: 'Journal entry not found' }, { status: 404 });
  }
  const branchId = journalEntry.line_branch_id || journalEntry.branch_id || null;

  try {
    await authorize(userId, 'journal', 'delete', {
      businessId,
      branchId: branchId ?? undefined,
      resourceId: voucherId,
      entry_date: journalEntry.entry_date,
      resource: journalEntry,
    });
  } catch (error) {
    if (error instanceof AuthorizationError) return error.toNextResponse();
    throw error;
  }

  if (journalEntry.is_locked) {
    return NextResponse.json({ error: 'Journal entry is locked', code: 'JOURNAL_LOCKED' }, { status: 403 });
  }

  const accountIds = (
    await queryRows<{ account_id: string }>(
      `SELECT DISTINCT account_id FROM ledger_entry_lines
        WHERE voucher_id = $1 AND business_id = $2 AND voucher_type = 'journal'`,
      [voucherId, businessId]
    )
  ).map((r) => r.account_id);
  const lockRes = await periodGuardResponse({
    businessId,
    branchId,
    dates: [journalEntry.entry_date],
    action: 'reverse this journal entry',
    checkGstFiled: await touchesGstAccounts(businessId, accountIds),
  });
  if (lockRes) return lockRes;

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await reverseJournal(client, { businessId, voucherId, userId, reason });
    if (result !== 'reversed') {
      await client.query('ROLLBACK');
      return result === 'not_found'
        ? NextResponse.json({ error: 'Journal entry not found' }, { status: 404 })
        : NextResponse.json(
            { error: 'Journal entry is already reversed', code: 'JOURNAL_ALREADY_REVERSED' },
            { status: 409 }
          );
    }
    await client.query('COMMIT');
  } catch (error: any) {
    await client.query('ROLLBACK').catch(() => {});
    if (error?.hint === 'LEDGER_PERIOD_LOCKED' || /locked period/i.test(error?.message || '')) {
      return NextResponse.json({ error: error.message, code: 'PERIOD_LOCKED' }, { status: 403 });
    }
    console.error('Error reversing journal entry:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  } finally {
    client.release();
  }

  try {
    const { logActivity, getClientIP, getUserAgent } = await import('@/lib/activity-logger');
    await logActivity({
      business_id: businessId,
      user_id: userId,
      action_type: 'update',
      module: 'journal',
      entity_id: voucherId,
      entity_type: 'journal_entry',
      description: `Reversed journal ${journalEntry.voucher_number || voucherId}: ${reason}`,
      ip_address: getClientIP(request),
      user_agent: getUserAgent(request),
      metadata: { reason },
    });
  } catch (e) {
    console.error('Activity log failed for journal reversal:', e);
  }

  return NextResponse.json({ message: 'Journal entry reversed', voucher_id: voucherId, reversed: true });
}
