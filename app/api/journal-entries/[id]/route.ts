import { NextRequest, NextResponse } from 'next/server';
import {
  getUserIdFromRequest,
  getBusinessIdFromRequest,
  getSessionScopedBusinessId,
} from '@/lib/auth-helpers';
import { queryOne, query, getPool } from '@/lib/db';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { enforceAccess, enforceAccessErrorResponse } from '@/lib/enforce-access';
import { FeatureKeys } from '@/lib/featureKeys';

/**
 * GET /api/journal-entries/[id]
 * Get journal entry details
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
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    if (!userId) {
      return NextResponse.json(
        { error: 'user_id is required for authorization' },
        { status: 400 }
      );
    }

    // Get journal entry metadata from journal_entries table
    const journalEntry = await queryOne(
      `SELECT 
        je.id,
        je.business_id,
        je.voucher_id,
        je.voucher_number,
        je.entry_date,
        je.reference_number,
        je.narration,
        je.is_locked,
        je.locked_at,
        je.locked_by,
        je.lock_reason,
        je.is_reversing,
        je.reverses_entry_id,
        je.reversal_date,
        je.template_id,
        je.tags,
        je.created_by,
        je.created_at,
        je.updated_at,
        u.name as locked_by_name
      FROM journal_entries je
      LEFT JOIN users u ON je.locked_by = u.id
      WHERE je.voucher_id = $1 AND je.business_id = $2`,
      [voucherId, businessId]
    );

    if (!journalEntry) {
      return NextResponse.json(
        { error: 'Journal entry not found' },
        { status: 404 }
      );
    }

    // Get branch_id from ledger_entry_lines for authorization
    const branchInfo = await queryOne(`
      SELECT DISTINCT branch_id FROM ledger_entry_lines 
      WHERE voucher_id = $1 AND business_id = $2 AND voucher_type = 'journal' 
      LIMIT 1
    `, [voucherId, businessId]);

    // AUTHORIZATION: Check read permission (PBAC will check branch access, business ownership)
    try {
      await authorize(userId, 'journal', 'read', {
        businessId: journalEntry.business_id || businessId,
        branchId: branchInfo?.branch_id || null,
        resourceId: voucherId,
        resource: journalEntry,
      });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    // Get line count and totals from ledger_entry_lines
    const entrySummary = await queryOne(
      `SELECT 
        COUNT(DISTINCT lel.id) as line_count,
        SUM(lel.debit) as total_debit,
        SUM(lel.credit) as total_credit
      FROM ledger_entry_lines lel
      WHERE lel.voucher_id = $1 AND lel.business_id = $2 AND lel.voucher_type = 'journal'`,
      [voucherId, businessId]
    );

    const entry = {
      ...journalEntry,
      line_count: parseInt(entrySummary?.line_count || '0'),
      total_debit: parseFloat(entrySummary?.total_debit || '0'),
      total_credit: parseFloat(entrySummary?.total_credit || '0'),
    };

    // Get lines
    const lines = await queryOne(`
      SELECT 
        lel.id,
        lel.account_id,
        lel.debit,
        lel.credit,
        lel.narration,
        lel.reference_number,
        lel.entry_date,
        lel.created_at,
        a.account_code,
        a.account_name
      FROM ledger_entry_lines lel
      LEFT JOIN accounts a ON lel.account_id = a.id
      WHERE lel.voucher_id = $1 AND lel.business_id = $2
      ORDER BY lel.created_at
    `, [voucherId, businessId]);

    return NextResponse.json({
      entry,
      lines: lines || [],
    });
  } catch (error: any) {
    console.error('Error fetching journal entry:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/journal-entries/[id]
 * Update journal entry (if not locked)
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const pool = getPool();
  const client = await pool.connect();

  try {
    const voucherId = params.id;
    const body = await request.json();
    const business_id = getSessionScopedBusinessId(request);
    const { entry_date, reference_number, narration, lines } = body;
    const updated_by = body.updated_by || getUserIdFromRequest(request, body) || request.headers.get('x-user-id');

    if (!business_id) {
      client.release();
      return NextResponse.json(
        { error: 'business_id is required (session scope)' },
        { status: 400 }
      );
    }

    if (!updated_by) {
      client.release();
      return NextResponse.json(
        { error: 'updated_by (user_id) is required for authorization' },
        { status: 400 }
      );
    }

    // Fetch journal entry for authorization
    const journalEntry = await queryOne(
      `SELECT je.*, lel.branch_id
       FROM journal_entries je
       LEFT JOIN ledger_entry_lines lel ON lel.voucher_id = je.voucher_id AND lel.business_id = je.business_id AND lel.voucher_type = 'journal'
       WHERE je.voucher_id = $1 AND je.business_id = $2
       LIMIT 1`,
      [voucherId, business_id]
    );

    if (!journalEntry) {
      client.release();
      return NextResponse.json(
        { error: 'Journal entry not found' },
        { status: 404 }
      );
    }

    // AUTHORIZATION: Check update permission (PBAC will check branch access, business ownership, is_locked, period lock)
    // Note: Status and period lock validation is now handled by PBAC policy - removed inline checks
    try {
      await authorize(updated_by, 'journal', 'update', {
        businessId: business_id,
        branchId: journalEntry.branch_id || null,
        resourceId: voucherId,
        entry_date: entry_date || journalEntry.entry_date,
        resource: journalEntry,
      });
    } catch (error) {
      client.release();
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    const patchBranchId = (journalEntry as { branch_id?: string | null }).branch_id ?? null;
    try {
      await enforceAccess({
        businessId: business_id,
        userId: updated_by,
        branchId: patchBranchId,
        feature: FeatureKeys.LEDGER_ACCOUNTING,
      });
    } catch (e) {
      const res = enforceAccessErrorResponse(e);
      if (res) {
        return res;
      }
      throw e;
    }

    // Validate debit = credit if lines provided
    if (lines && Array.isArray(lines)) {
      const totalDebit = lines.reduce((sum, line) => sum + (parseFloat(line.debit?.toString() || '0')), 0);
      const totalCredit = lines.reduce((sum, line) => sum + (parseFloat(line.credit?.toString() || '0')), 0);

      if (Math.abs(totalDebit - totalCredit) > 0.01) {
        return NextResponse.json(
          { error: `Debit and Credit must be equal. Debit: ${totalDebit}, Credit: ${totalCredit}` },
          { status: 400 }
        );
      }
    }

    await client.query('BEGIN');

    // Delete existing lines
    await client.query(
      'DELETE FROM ledger_entry_lines WHERE voucher_id = $1 AND business_id = $2',
      [voucherId, business_id]
    );

    await client.query(
      'DELETE FROM ledger_entries WHERE transaction_id = $1 AND business_id = $2 AND transaction_type = $3',
      [voucherId, business_id, 'journal']
    );

    // Insert new lines
    if (lines && Array.isArray(lines)) {
      for (const line of lines) {
        await client.query(`
          INSERT INTO ledger_entry_lines (
            business_id, voucher_id, voucher_type, account_id, entry_date,
            debit, credit, narration, reference_number, branch_id
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        `, [
          business_id,
          voucherId,
          'journal',
          line.account_id,
          entry_date || new Date().toISOString().split('T')[0],
          parseFloat(line.debit?.toString() || '0'),
          parseFloat(line.credit?.toString() || '0'),
          line.narration || narration || null,
          reference_number || null,
          patchBranchId,
        ]);

        // Also create entry in ledger_entries
        const account = await client.query(
          'SELECT nature FROM accounts WHERE id = $1 AND business_id = $2',
          [line.account_id, business_id]
        );
        const accountNature = account.rows[0]?.nature || 'debit';
        
        const currentBalance = await client.query(`
          SELECT get_account_balance($1, $2, $3, $4) as balance
        `, [line.account_id, business_id, entry_date || new Date().toISOString().split('T')[0], patchBranchId]);
        
        const balance = parseFloat(currentBalance.rows[0]?.balance || '0');
        const debit = parseFloat(line.debit?.toString() || '0');
        const credit = parseFloat(line.credit?.toString() || '0');
        
        let newBalance = balance;
        if (accountNature === 'debit') {
          newBalance = balance + debit - credit;
        } else {
          newBalance = balance + credit - debit;
        }

        const voucherNumber = await client.query(
          `SELECT voucher_number FROM ledger_entry_lines WHERE voucher_id = $1 AND business_id = $2 LIMIT 1`,
          [voucherId, business_id]
        );

        await client.query(`
          INSERT INTO ledger_entries (
            business_id, branch_id, entry_date, account_id, account_type, transaction_type,
            transaction_id, debit, credit, balance, description,
            voucher_number, voucher_type, reference_number
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        `, [
          business_id,
          patchBranchId,
          entry_date || new Date().toISOString().split('T')[0],
          line.account_id,
          'account',
          'journal',
          voucherId,
          debit,
          credit,
          newBalance,
          line.narration || narration || 'Journal Entry',
          voucherNumber.rows[0]?.voucher_number || null,
          'journal',
          reference_number || null,
        ]);
      }
    }

    await client.query('COMMIT');

    return NextResponse.json({ message: 'Journal entry updated successfully' });
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('Error updating journal entry:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}

/**
 * DELETE /api/journal-entries/[id]
 * Delete journal entry (if not locked)
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const pool = getPool();
  const client = await pool.connect();

  try {
    const voucherId = params.id;
    const businessId =
      getSessionScopedBusinessId(request) ?? getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);

    if (!businessId) {
      client.release();
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    if (!userId) {
      client.release();
      return NextResponse.json(
        { error: 'user_id is required for authorization' },
        { status: 400 }
      );
    }

    // Fetch journal entry for authorization
    const journalEntry = await queryOne(
      `SELECT je.*, lel.branch_id
       FROM journal_entries je
       LEFT JOIN ledger_entry_lines lel ON lel.voucher_id = je.voucher_id AND lel.business_id = je.business_id AND lel.voucher_type = 'journal'
       WHERE je.voucher_id = $1 AND je.business_id = $2
       LIMIT 1`,
      [voucherId, businessId]
    );

    if (!journalEntry) {
      client.release();
      return NextResponse.json(
        { error: 'Journal entry not found' },
        { status: 404 }
      );
    }

    // AUTHORIZATION: Check delete permission (PBAC will check branch access, business ownership, is_locked, period lock)
    // Note: Status and period lock validation is now handled by PBAC policy - removed inline checks
    try {
      await authorize(userId, 'journal', 'delete', {
        businessId: businessId,
        branchId: journalEntry.branch_id || null,
        resourceId: voucherId,
        entry_date: journalEntry.entry_date,
        resource: journalEntry,
      });
    } catch (error) {
      client.release();
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    await client.query('BEGIN');

    // Delete lines
    await client.query(
      'DELETE FROM ledger_entry_lines WHERE voucher_id = $1 AND business_id = $2',
      [voucherId, businessId]
    );

    // Delete ledger entries
    await client.query(
      'DELETE FROM ledger_entries WHERE transaction_id = $1 AND business_id = $2 AND transaction_type = $3',
      [voucherId, businessId, 'journal']
    );

    await client.query('COMMIT');

    return NextResponse.json({ message: 'Journal entry deleted successfully' });
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('Error deleting journal entry:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}

