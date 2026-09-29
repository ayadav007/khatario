export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import {
  getUserIdFromRequest,
  getBusinessIdFromRequest,
  getSessionScopedBusinessId,
} from '@/lib/auth-helpers';
import { queryOne, queryRows, getPool } from '@/lib/db';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { enforceAccess, enforceAccessErrorResponse } from '@/lib/enforce-access';
import { FeatureKeys } from '@/lib/featureKeys';
import { periodGuardResponse, touchesGstAccounts } from '@/lib/http/period-guards';
import {
  activeJournalLines,
  deleteJournalByReversal,
  journalDisplayLineSql,
  journalIsReversedSql,
  JOURNAL_REVERSAL_REASON_PREFIX,
  repostJournal,
} from '@/lib/accounting/journal-corrections';

import { type JournalLineInput, validateJournalLines } from '@/lib/accounting/journal-lines';

async function journalAccountIds(voucherId: string, businessId: string): Promise<string[]> {
  const rows = await queryRows<{ account_id: string }>(
    `SELECT DISTINCT account_id FROM ledger_entry_lines
      WHERE voucher_id = $1 AND business_id = $2 AND voucher_type = 'journal'`,
    [voucherId, businessId]
  );
  return rows.map((r) => r.account_id);
}

async function loadJournal(voucherId: string, businessId: string) {
  return queryOne(
    `SELECT je.*,
            (SELECT lel.branch_id FROM ledger_entry_lines lel
              WHERE lel.voucher_id = je.voucher_id AND lel.business_id = je.business_id
                AND lel.voucher_type = 'journal' AND lel.branch_id IS NOT NULL
              LIMIT 1) AS line_branch_id
       FROM journal_entries je
      WHERE je.voucher_id = $1 AND je.business_id = $2 AND je.deleted_at IS NULL`,
    [voucherId, businessId]
  );
}

/**
 * GET /api/journal-entries/[id]
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const voucherId = params.id;
    const businessId =
      getSessionScopedBusinessId(request) ?? getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);

    if (!businessId) {
      return NextResponse.json({ error: 'business_id is required' }, { status: 400 });
    }
    if (!userId) {
      return NextResponse.json({ error: 'user_id is required for authorization' }, { status: 400 });
    }

    const journalEntry = await queryOne(
      `SELECT je.id, je.business_id, je.voucher_id, je.voucher_number, je.entry_date,
              je.reference_number, je.narration, je.is_locked, je.locked_at, je.locked_by,
              je.lock_reason, je.is_reversing, je.reverses_entry_id, je.reversal_date,
              je.template_id, je.tags, je.created_by, je.created_at, je.updated_at,
              u.name as locked_by_name,
              ${journalIsReversedSql('je.voucher_id', 'je.business_id')} AS is_reversed
         FROM journal_entries je
         LEFT JOIN users u ON je.locked_by = u.id
        WHERE je.voucher_id = $1 AND je.business_id = $2
          AND (je.deleted_at IS NULL OR ${journalIsReversedSql('je.voucher_id', 'je.business_id')})`,
      [voucherId, businessId]
    );

    if (!journalEntry) {
      return NextResponse.json({ error: 'Journal entry not found' }, { status: 404 });
    }

    const branchInfo = await queryOne(
      `SELECT branch_id FROM ledger_entry_lines
        WHERE voucher_id = $1 AND business_id = $2 AND voucher_type = 'journal'
        LIMIT 1`,
      [voucherId, businessId]
    );

    try {
      await authorize(userId, 'journal', 'read', {
        businessId: journalEntry.business_id || businessId,
        branchId: branchInfo?.branch_id || null,
        resourceId: voucherId,
        resource: journalEntry,
      });
    } catch (error) {
      if (error instanceof AuthorizationError) return error.toNextResponse();
      throw error;
    }

    const lines = await queryRows(
      `SELECT lel.id, lel.account_id, lel.debit, lel.credit, lel.narration,
              lel.reference_number, lel.entry_date, lel.created_at,
              a.account_code, a.account_name
         FROM ledger_entry_lines lel
         LEFT JOIN accounts a ON lel.account_id = a.id
        WHERE lel.voucher_id = $1 AND lel.business_id = $2 AND lel.voucher_type = 'journal'
          AND ${journalDisplayLineSql('lel')}
        ORDER BY lel.created_at, lel.id`,
      [voucherId, businessId]
    );

    const totalDebit = lines.reduce((s, l) => s + parseFloat(l.debit || '0'), 0);
    const totalCredit = lines.reduce((s, l) => s + parseFloat(l.credit || '0'), 0);

    let reversal: {
      reason: string | null;
      reversed_at: string;
      reversed_by_name: string | null;
      lines: unknown[];
    } | null = null;
    if (journalEntry.is_reversed && lines.length > 0) {
      const reversalLines = await queryRows(
        `SELECT r.id, r.account_id, r.debit, r.credit, r.narration, r.entry_date, r.created_at,
                a.account_code, a.account_name, ler.original_line_id, ler.reason, ler.created_at AS reversed_at,
                u.name AS reversed_by_name
           FROM ledger_entry_reversals ler
           JOIN ledger_entry_lines r ON r.id = ler.reversal_line_id
           LEFT JOIN accounts a ON a.id = r.account_id
           LEFT JOIN users u ON u.id = ler.created_by
          WHERE ler.business_id = $2 AND ler.voucher_type = 'journal' AND ler.voucher_id = $1
            AND ler.original_line_id = ANY($3::uuid[])
          ORDER BY r.created_at, r.id`,
        [voucherId, businessId, lines.map((l) => l.id)]
      );
      const first = reversalLines[0];
      if (first) {
        const rawReason: string = first.reason || '';
        reversal = {
          reason: rawReason.replace(new RegExp(`^(${JOURNAL_REVERSAL_REASON_PREFIX}|Journal deleted:?)\\s*`), '') || null,
          reversed_at: first.reversed_at,
          reversed_by_name: first.reversed_by_name ?? null,
          lines: reversalLines.map(({ reason: _r, reversed_at: _a, reversed_by_name: _n, ...l }) => l),
        };
      }
    }

    return NextResponse.json({
      entry: {
        ...journalEntry,
        line_count: lines.length,
        total_debit: Math.round(totalDebit * 100) / 100,
        total_credit: Math.round(totalCredit * 100) / 100,
      },
      lines,
      reversal,
    });
  } catch (error: any) {
    console.error('Error fetching journal entry:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}

/**
 * PATCH /api/journal-entries/[id]
 * Without `lines`: updates narration / reference / date of the header and existing lines.
 * With `lines`: replaces all lines in one transaction (must balance).
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const voucherId = params.id;
  let body: Record<string, any>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const business_id = getSessionScopedBusinessId(request);
  const { entry_date, reference_number, narration, lines } = body;
  const updated_by = body.updated_by || getUserIdFromRequest(request, body) || request.headers.get('x-user-id');

  if (!business_id) {
    return NextResponse.json({ error: 'business_id is required (session scope)' }, { status: 400 });
  }
  if (!updated_by) {
    return NextResponse.json({ error: 'updated_by (user_id) is required for authorization' }, { status: 400 });
  }

  const journalEntry = await loadJournal(voucherId, business_id);
  if (!journalEntry) {
    return NextResponse.json({ error: 'Journal entry not found' }, { status: 404 });
  }
  const branchId: string | null = journalEntry.line_branch_id || journalEntry.branch_id || null;
  const newDate = entry_date || journalEntry.entry_date;

  try {
    await authorize(updated_by, 'journal', 'update', {
      businessId: business_id,
      branchId: branchId ?? undefined,
      resourceId: voucherId,
      entry_date: newDate,
      resource: journalEntry,
    });
  } catch (error) {
    if (error instanceof AuthorizationError) return error.toNextResponse();
    throw error;
  }

  try {
    await enforceAccess({
      businessId: business_id,
      userId: updated_by,
      branchId,
      feature: FeatureKeys.LEDGER_ACCOUNTING,
    });
  } catch (e) {
    const res = enforceAccessErrorResponse(e);
    if (res) return res;
    throw e;
  }

  if (journalEntry.is_locked) {
    return NextResponse.json({ error: 'Journal entry is locked', code: 'JOURNAL_LOCKED' }, { status: 403 });
  }

  const reversed = await queryOne<{ reversed: boolean }>(
    `SELECT ${journalIsReversedSql('$1::uuid', '$2::uuid')} AS reversed`,
    [voucherId, business_id]
  );
  if (reversed?.reversed) {
    return NextResponse.json(
      { error: 'A reversed journal entry cannot be edited', code: 'JOURNAL_REVERSED' },
      { status: 409 }
    );
  }

  const existingAccountIds = await journalAccountIds(voucherId, business_id);
  const newAccountIds = Array.isArray(lines)
    ? (lines as Array<{ account_id?: string }>).map((l) => l.account_id).filter((x): x is string => !!x)
    : [];
  const lockRes = await periodGuardResponse({
    businessId: business_id,
    branchId,
    dates: [journalEntry.entry_date, entry_date],
    action: 'edit this journal entry',
    checkGstFiled: await touchesGstAccounts(business_id, [...existingAccountIds, ...newAccountIds]),
  });
  if (lockRes) return lockRes;

  const replaceLines = Array.isArray(lines);
  if (replaceLines) {
    const err = validateJournalLines(lines);
    if (err) return NextResponse.json({ error: err }, { status: 400 });
    const accountIds = [...new Set(lines.map((l: JournalLineInput) => l.account_id))];
    const found = await queryOne<{ n: string }>(
      `SELECT COUNT(*)::int AS n FROM accounts WHERE business_id = $1 AND id = ANY($2::uuid[]) AND is_active = true`,
      [business_id, accountIds]
    );
    if (Number(found?.n || 0) !== accountIds.length) {
      return NextResponse.json({ error: 'One or more accounts are invalid or inactive' }, { status: 400 });
    }
  }

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `UPDATE journal_entries
          SET entry_date = COALESCE($3, entry_date),
              reference_number = CASE WHEN $4::boolean THEN $5 ELSE reference_number END,
              narration = CASE WHEN $6::boolean THEN $7 ELSE narration END,
              updated_by = $8,
              updated_at = CURRENT_TIMESTAMP
        WHERE voucher_id = $1 AND business_id = $2`,
      [
        voucherId,
        business_id,
        entry_date || null,
        reference_number !== undefined,
        reference_number ?? null,
        narration !== undefined,
        narration ?? null,
        updated_by,
      ]
    );

    // Ledger lines are immutable (prevent_ledger_entry_update trigger), so only a date change
    // re-posts the same amounts; narration and reference edits stay on the header.
    const oldDay = journalEntry.entry_date instanceof Date
      ? `${journalEntry.entry_date.getFullYear()}-${String(journalEntry.entry_date.getMonth() + 1).padStart(2, '0')}-${String(journalEntry.entry_date.getDate()).padStart(2, '0')}`
      : String(journalEntry.entry_date).slice(0, 10);
    const dateChanged = !!entry_date && String(entry_date).slice(0, 10) !== oldDay;
    let linesToPost: JournalLineInput[] | null = replaceLines ? (lines as JournalLineInput[]) : null;
    if (!replaceLines && dateChanged) {
      const existing = await activeJournalLines(client, business_id, voucherId);
      if (existing.length >= 2) {
        linesToPost = existing.map((r) => ({
          account_id: r.account_id,
          debit: r.debit,
          credit: r.credit,
          narration: narration !== undefined ? undefined : r.narration ?? undefined,
        }));
      }
    }

    if (linesToPost) {
      const lineRef = reference_number !== undefined ? reference_number : journalEntry.reference_number;
      await repostJournal(client, {
        businessId: business_id,
        voucherId,
        userId: updated_by,
        branchId,
        entryDate: newDate,
        lines: linesToPost,
        narration: (narration !== undefined ? narration : journalEntry.narration) || null,
        reference: lineRef || null,
        voucherNumber: journalEntry.voucher_number ?? null,
      });
    }

    await client.query('COMMIT');
    return NextResponse.json({ message: 'Journal entry updated successfully' });
  } catch (error: any) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error updating journal entry:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  } finally {
    client.release();
  }
}

/**
 * DELETE /api/journal-entries/[id]
 * Removes the ledger lines and soft-deletes the header (number stays used for the audit trail).
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const voucherId = params.id;
  const businessId =
    getSessionScopedBusinessId(request) ?? getBusinessIdFromRequest(request);
  const userId = getUserIdFromRequest(request);
  const reason = new URL(request.url).searchParams.get('reason');

  if (!businessId) {
    return NextResponse.json({ error: 'business_id is required' }, { status: 400 });
  }
  if (!userId) {
    return NextResponse.json({ error: 'user_id is required for authorization' }, { status: 400 });
  }

  const journalEntry = await loadJournal(voucherId, businessId);
  if (!journalEntry) {
    return NextResponse.json({ error: 'Journal entry not found' }, { status: 404 });
  }
  const branchId: string | null = journalEntry.line_branch_id || journalEntry.branch_id || null;

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

  const lockRes = await periodGuardResponse({
    businessId,
    branchId,
    dates: [journalEntry.entry_date],
    action: 'delete this journal entry',
    checkGstFiled: await touchesGstAccounts(businessId, await journalAccountIds(voucherId, businessId)),
  });
  if (lockRes) return lockRes;

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const ok = await deleteJournalByReversal(client, { businessId, voucherId, userId, reason: reason || null });
    if (!ok) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Journal entry not found' }, { status: 404 });
    }
    await client.query('COMMIT');
    return NextResponse.json({ message: 'Journal entry deleted successfully' });
  } catch (error: any) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error deleting journal entry:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  } finally {
    client.release();
  }
}
