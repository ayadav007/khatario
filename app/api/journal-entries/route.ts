import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import { queryRows, queryOne, query, getPool } from '@/lib/db';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { enforceAccess, enforceAccessErrorResponse } from '@/lib/enforce-access';
import { FeatureKeys } from '@/lib/featureKeys';

interface JournalEntryLine {
  account_id: string;
  debit: number;
  credit: number;
  narration?: string;
}

/**
 * GET /api/journal-entries
 * List journal entries
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request); // REQUIRED for authorization
    const fromDate = searchParams.get('from_date');
    const toDate = searchParams.get('to_date');

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

    // AUTHORIZATION: Check read permission (PBAC will check branch access, business ownership)
    try {
      await authorize(userId, 'journal', 'read', {
        businessId,
      });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    // Join with journal_entries table to get metadata
    let sql = `
      SELECT DISTINCT
        je.voucher_id,
        je.voucher_number,
        je.entry_date,
        je.reference_number,
        je.narration,
        je.is_locked,
        je.is_reversing,
        je.template_id,
        je.tags,
        COUNT(DISTINCT lel.id) as line_count,
        SUM(lel.debit) as total_debit,
        SUM(lel.credit) as total_credit
      FROM ledger_entry_lines lel
      LEFT JOIN journal_entries je ON lel.voucher_id = je.voucher_id AND lel.business_id = je.business_id
      WHERE lel.business_id = $1 AND lel.voucher_type = 'journal'
    `;
    const params: any[] = [businessId];
    let paramIndex = 2;

    if (fromDate) {
      sql += ` AND lel.entry_date >= $${paramIndex}`;
      params.push(fromDate);
      paramIndex++;
    }

    if (toDate) {
      sql += ` AND lel.entry_date <= $${paramIndex}`;
      params.push(toDate);
      paramIndex++;
    }

    sql += ` GROUP BY je.voucher_id, je.voucher_number, je.entry_date, je.reference_number, je.narration, je.is_locked, je.is_reversing, je.template_id, je.tags`;

    // Get total count for pagination (count distinct voucher_ids)
    const countSql = `
      SELECT COUNT(DISTINCT je.voucher_id) as total
      FROM ledger_entry_lines lel
      LEFT JOIN journal_entries je ON lel.voucher_id = je.voucher_id AND lel.business_id = je.business_id
      WHERE lel.business_id = $1 AND lel.voucher_type = 'journal'
      ${fromDate ? `AND lel.entry_date >= $${params.length}` : ''}
      ${toDate ? `AND lel.entry_date <= $${params.length + (fromDate ? 1 : 0)}` : ''}
    `;
    const countParams = [businessId];
    if (fromDate) countParams.push(fromDate);
    if (toDate) countParams.push(toDate);
    const countResult = await queryOne<{ total: number }>(countSql, countParams);
    const total = countResult?.total || 0;

    // Add pagination
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = (page - 1) * limit;

    sql += ` ORDER BY je.entry_date DESC, je.voucher_number DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const entries = await queryRows(sql, params);

    // Fetch lines for each entry
    const entriesWithLines = await Promise.all(
      entries.map(async (entry: any) => {
        const lines = await queryRows(`
          SELECT 
            lel.*,
            a.account_code,
            a.account_name
          FROM ledger_entry_lines lel
          LEFT JOIN accounts a ON lel.account_id = a.id
          WHERE lel.voucher_id = $1 AND lel.business_id = $2
          ORDER BY lel.created_at
        `, [entry.voucher_id, businessId]);

        return {
          ...entry,
          lines,
        };
      })
    );

    return NextResponse.json({ 
      entries: entriesWithLines,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error: any) {
    console.error('Error fetching journal entries:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/journal-entries
 * Create a new journal entry
 */
export async function POST(request: NextRequest) {
  const pool = getPool();
  const client = await pool.connect();

  try {
    const body = await request.json();
    const {
      business_id,
      branch_id, // CRITICAL: Branch ID for branch-wise accounting
      entry_date,
      reference_number,
      narration,
      lines, // Array of { account_id, debit, credit, narration }
      is_reversing,
      reverses_entry_id,
      reversal_date,
      template_id,
      tags,
      backdate_reason, // Reason for backdating (if applicable)
      created_by, // User ID who created the journal entry
    } = body;

    if (!business_id || !entry_date || !lines || !Array.isArray(lines) || lines.length < 2) {
      return NextResponse.json(
        { error: 'business_id, entry_date, and at least 2 lines are required' },
        { status: 400 }
      );
    }

    if (!created_by) {
      return NextResponse.json(
        { error: 'created_by (user_id) is required for authorization' },
        { status: 400 }
      );
    }

    // CRITICAL: Resolve branch_id using helper (handles default branch fallback)
    const { resolveBranchId } = await import('@/lib/branch-helpers');
    let finalBranchId: string;
    try {
      finalBranchId = await resolveBranchId({
        branchId: branch_id,
        businessId: business_id,
      });
    } catch (error: any) {
      if (error.code === 'BRANCH_NOT_FOUND' || error.code === 'BRANCH_BUSINESS_MISMATCH' || error.code === 'BRANCH_INACTIVE') {
        return NextResponse.json(
          { error: error.message },
          { status: 400 }
        );
      }
      if (error.code === 'NO_DEFAULT_BRANCH') {
        return NextResponse.json(
          { error: error.message },
          { status: 500 }
        );
      }
      throw error;
    }

    // AUTHORIZATION: Check create permission (PBAC will check period lock, branch access)
    // Note: Period lock validation is now handled by PBAC policy - removed inline check
    try {
      await authorize(created_by, 'journal', 'create', {
        businessId: business_id,
        branchId: finalBranchId,
        entry_date: entry_date,
      });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    try {
      await enforceAccess({
        businessId: business_id,
        userId: created_by,
        branchId: finalBranchId,
        feature: FeatureKeys.LEDGER_ACCOUNTING,
      });
    } catch (e) {
      const res = enforceAccessErrorResponse(e);
      if (res) return res;
      throw e;
    }

    // CRITICAL: Validate backdated entry
    const { validateBackdate, hasBackdateApprovalPermission } = await import('@/lib/backdate-controls');
    const backdateValidation = validateBackdate(entry_date, 365, 30); // Max 365 days, approval required after 30 days
    
    if (backdateValidation.isBackdated) {
      if (backdateValidation.error) {
        return NextResponse.json(
          { 
            error: backdateValidation.error,
            code: 'BACKDATE_EXCEEDS_LIMIT',
            days_backdated: backdateValidation.daysBackdated
          },
          { status: 400 }
        );
      }
      
      if (backdateValidation.requiresApproval && created_by) {
        const hasApproval = await hasBackdateApprovalPermission(created_by, backdateValidation.daysBackdated);
        
        if (!hasApproval) {
          return NextResponse.json(
            { 
              error: `Backdated entries > 30 days require approval. Entry is ${backdateValidation.daysBackdated} days old.`,
              code: 'BACKDATE_APPROVAL_REQUIRED',
              days_backdated: backdateValidation.daysBackdated
            },
            { status: 403 }
          );
        }
        
        // Require reason for backdating
        if (!backdate_reason) {
          return NextResponse.json(
            { 
              error: 'backdate_reason is required for backdated entries > 30 days',
              code: 'BACKDATE_REASON_REQUIRED',
              days_backdated: backdateValidation.daysBackdated
            },
            { status: 400 }
          );
        }
      }
    }

    // Validate debit = credit
    const totalDebit = lines.reduce((sum, line) => sum + (parseFloat(line.debit?.toString() || '0')), 0);
    const totalCredit = lines.reduce((sum, line) => sum + (parseFloat(line.credit?.toString() || '0')), 0);

    if (Math.abs(totalDebit - totalCredit) > 0.01) {
      return NextResponse.json(
        { error: `Debit and Credit must be equal. Debit: ${totalDebit}, Credit: ${totalCredit}` },
        { status: 400 }
      );
    }

    // Validate each line has either debit or credit (not both, not neither)
    for (const line of lines) {
      const debit = parseFloat(line.debit?.toString() || '0');
      const credit = parseFloat(line.credit?.toString() || '0');
      
      if (debit > 0 && credit > 0) {
        return NextResponse.json(
          { error: 'Each line must have either debit or credit, not both' },
          { status: 400 }
        );
      }
      
      if (debit === 0 && credit === 0) {
        return NextResponse.json(
          { error: 'Each line must have either debit or credit' },
          { status: 400 }
        );
      }

      if (!line.account_id) {
        return NextResponse.json(
          { error: 'All lines must have an account_id' },
          { status: 400 }
        );
      }
    }

    await client.query('BEGIN');

    // Generate voucher number
    const voucherNumberResult = await client.query(
      'SELECT generate_voucher_number($1, $2, $3) as voucher_number',
      [business_id, 'journal', entry_date]
    );
    const voucherNumber = voucherNumberResult.rows[0].voucher_number;

    // Generate voucher_id (UUID)
    const voucherIdResult = await client.query('SELECT uuid_generate_v4() as id');
    const voucherId = voucherIdResult.rows[0].id;

    // If this is a reversing entry, get the original entry's lines and reverse them
    let finalLines = lines;
    if (is_reversing && reverses_entry_id) {
      const originalLinesResult = await client.query(
        `SELECT account_id, debit, credit, narration, branch_id
         FROM ledger_entry_lines 
         WHERE voucher_id = $1 AND business_id = $2 AND voucher_type = 'journal'
         ORDER BY created_at`,
        [reverses_entry_id, business_id]
      );

      if (originalLinesResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          { error: 'Original journal entry not found for reversal' },
          { status: 404 }
        );
      }

      const origBranch =
        originalLinesResult.rows.find((r: { branch_id?: string | null }) => r.branch_id)?.branch_id ??
        null;

      // Reverse the lines: swap debit and credit
      finalLines = originalLinesResult.rows.map((line: any) => ({
        account_id: line.account_id,
        debit: line.credit, // Swap: original credit becomes debit
        credit: line.debit, // Swap: original debit becomes credit
        narration: line.narration || `Reversal of entry ${reverses_entry_id.substring(0, 8)}`,
        _branch_id: line.branch_id ?? origBranch,
      }));
    }

    // Insert ledger entry lines
    for (const line of finalLines) {
      const lineBranchId = (line as { _branch_id?: string })._branch_id ?? finalBranchId;
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
        entry_date,
        parseFloat(line.debit?.toString() || '0'),
        parseFloat(line.credit?.toString() || '0'),
        line.narration || narration || null,
        reference_number || null,
        lineBranchId,
      ]);

      // Also create entry in ledger_entries for backward compatibility
      const account = await client.query('SELECT nature FROM accounts WHERE id = $1', [line.account_id]);
      const accountNature = account.rows[0]?.nature || 'debit';
      
      // Calculate balance (simplified - would need to fetch current balance)
      const currentBalance = await client.query(`
        SELECT get_account_balance($1, $2, $3, $4) as balance
      `, [line.account_id, business_id, entry_date, finalBranchId]);
      
      const balance = parseFloat(currentBalance.rows[0]?.balance || '0');
      const debit = parseFloat(line.debit?.toString() || '0');
      const credit = parseFloat(line.credit?.toString() || '0');
      
      let newBalance = balance;
      if (accountNature === 'debit') {
        newBalance = balance + debit - credit;
      } else {
        newBalance = balance + credit - debit;
      }

      await client.query(`
        INSERT INTO ledger_entries (
          business_id, branch_id, entry_date, account_id, account_type, transaction_type,
          transaction_id, debit, credit, balance, description,
          voucher_number, voucher_type, reference_number
        )
        VALUES ($1, $2, $3, $4, 'account', 'journal', $5, $6, $7, $8, $9, $10, $11, $12)
      `, [
        business_id,
        lineBranchId,
        entry_date,
        line.account_id,
        voucherId,
        debit,
        credit,
        newBalance,
        line.narration || narration || 'Journal Entry',
        voucherNumber,
        'journal',
        reference_number || null,
      ]);
    }

    const journalMetaBranchId =
      (finalLines[0] as { _branch_id?: string })?._branch_id ?? finalBranchId;

    // Create journal entry metadata record
    await query(
      `INSERT INTO journal_entries (
        business_id, branch_id, voucher_id, voucher_number, entry_date, 
        reference_number, narration, is_locked, created_by,
        is_reversing, reverses_entry_id, reversal_date, template_id, tags
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, false, $8, $9, $10, $11, $12, $13)
      ON CONFLICT (business_id, voucher_id) DO UPDATE SET
        branch_id = EXCLUDED.branch_id,
        voucher_number = EXCLUDED.voucher_number,
        entry_date = EXCLUDED.entry_date,
        reference_number = EXCLUDED.reference_number,
        narration = EXCLUDED.narration,
        is_reversing = EXCLUDED.is_reversing,
        reverses_entry_id = EXCLUDED.reverses_entry_id,
        reversal_date = EXCLUDED.reversal_date,
        template_id = EXCLUDED.template_id,
        tags = EXCLUDED.tags,
        updated_at = CURRENT_TIMESTAMP`,
      [
        business_id,
        journalMetaBranchId,
        voucherId,
        voucherNumber,
        entry_date,
        reference_number || null,
        narration || null,
        created_by,
        is_reversing || false,
        reverses_entry_id || null,
        reversal_date || null,
        template_id || null,
        tags && Array.isArray(tags) ? tags : null,
      ]
    );

    await client.query('COMMIT');

    return NextResponse.json({
      voucher_id: voucherId,
      voucher_number: voucherNumber,
      message: 'Journal entry created successfully',
    }, { status: 201 });
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('Error creating journal entry:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}

