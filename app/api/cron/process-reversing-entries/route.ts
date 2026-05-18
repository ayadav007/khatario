import { NextRequest, NextResponse } from 'next/server';
import { query, queryRows, queryOne, getPool } from '@/lib/db';
import { getBusinessSubscription, isSubscriptionOperationalStatus } from '@/lib/subscription';
import { hasFeature } from '@/lib/subscription';

/**
 * POST /api/cron/process-reversing-entries
 * Process scheduled reversing entries that are due today
 * This endpoint should be called by a cron job (e.g., daily at midnight)
 */
export async function POST(request: NextRequest) {
  const pool = getPool();
  const client = await pool.connect();

  try {
    // Verify cron secret if configured
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;
    
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const today = new Date().toISOString().split('T')[0];

    await client.query('BEGIN');

    // Find all journal entries that should be reversed today
    const entriesToReverse = await queryRows(
      `SELECT 
        id, business_id, voucher_id, voucher_number, reversal_date, reverses_entry_id
      FROM journal_entries
      WHERE is_reversing = true
        AND reversal_date = $1
        AND reverses_entry_id IS NOT NULL
      ORDER BY business_id, created_at`,
      [today]
    );

    let processedCount = 0;
    const errors: string[] = [];

    for (const entry of entriesToReverse) {
      try {
        // CRITICAL: Check if business has active subscription
        // Skip processing if subscription is inactive or expired
        const subscription = await getBusinessSubscription(entry.business_id);
        if (!subscription || !isSubscriptionOperationalStatus(subscription.status)) {
          console.log(`Skipping reversing entry ${entry.id}: business ${entry.business_id} subscription inactive or expired`);
          continue;
        }

        // Check if subscription has expired (if end_date is set)
        if (subscription.end_date) {
          const endDate = new Date(subscription.end_date);
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          
          if (endDate < today) {
            console.log(`Skipping reversing entry ${entry.id}: business ${entry.business_id} subscription expired on ${subscription.end_date}`);
            continue;
          }
        }

        // Check if business has access to recurring invoices feature (required for reversing entries)
        const hasRecurringAccess = await hasFeature(entry.business_id, 'recurring_invoices');
        if (!hasRecurringAccess) {
          console.log(`Skipping reversing entry ${entry.id}: business ${entry.business_id} does not have recurring_invoices feature`);
          continue;
        }

        // Check if reversing entry already exists
        const existingReversal = await queryOne(
          `SELECT id FROM journal_entries 
           WHERE reverses_entry_id = $1 AND business_id = $2`,
          [entry.reverses_entry_id, entry.business_id]
        );

        if (existingReversal) {
          // Already reversed, skip
          continue;
        }

        // Get original entry lines
        const originalLines = await queryRows<{
          account_id: string;
          debit: number;
          credit: number;
          narration: string | null;
          branch_id: string | null;
        }>(
          `SELECT account_id, debit, credit, narration, branch_id
           FROM ledger_entry_lines 
           WHERE voucher_id = $1 AND business_id = $2 AND voucher_type = 'journal'
           ORDER BY created_at`,
          [entry.reverses_entry_id, entry.business_id]
        );

        if (originalLines.length === 0) {
          errors.push(`Original entry ${entry.voucher_id} has no lines`);
          continue;
        }

        const reversalBranchId =
          originalLines.find((l) => l.branch_id)?.branch_id ?? null;

        // Generate new voucher_id for reversing entry
        const voucherIdResult = await client.query('SELECT uuid_generate_v4() as id');
        const newVoucherId = voucherIdResult.rows[0].id;

        // Generate voucher number
        const voucherNumberResult = await client.query(
          'SELECT generate_voucher_number($1, $2, $3) as voucher_number',
          [entry.business_id, 'journal', today]
        );
        const voucherNumber = voucherNumberResult.rows[0].voucher_number;

        // Create reversed lines (swap debit and credit)
        for (const line of originalLines) {
          await client.query(
            `INSERT INTO ledger_entry_lines (
              business_id, voucher_id, voucher_type, account_id, entry_date,
              debit, credit, narration, reference_number, branch_id
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [
              entry.business_id,
              newVoucherId,
              'journal',
              line.account_id,
              today,
              line.credit, // Swap: original credit becomes debit
              line.debit, // Swap: original debit becomes credit
              `Reversal of ${entry.voucher_number || entry.reverses_entry_id.substring(0, 8)}`,
              voucherNumber,
              line.branch_id ?? reversalBranchId,
            ]
          );

          // Also create entry in ledger_entries for backward compatibility
          const account = await client.query('SELECT nature FROM accounts WHERE id = $1', [line.account_id]);
          const accountNature = account.rows[0]?.nature || 'debit';
          
          const currentBalance = await client.query(
            `SELECT get_account_balance($1, $2, $3, $4) as balance`,
            [line.account_id, entry.business_id, today, line.branch_id ?? reversalBranchId]
          );
          
          const balance = parseFloat(String(currentBalance.rows[0]?.balance ?? '0'));
          const debit = Number(line.credit ?? 0);
          const credit = Number(line.debit ?? 0);
          
          let newBalance = balance;
          if (accountNature === 'debit') {
            newBalance = balance + debit - credit;
          } else {
            newBalance = balance + credit - debit;
          }

          await client.query(
            `INSERT INTO ledger_entries (
              business_id, branch_id, entry_date, account_id, account_type, transaction_type,
              transaction_id, debit, credit, balance, description,
              voucher_number, voucher_type, reference_number
            )
            VALUES ($1, $2, $3, $4, 'account', 'journal', $5, $6, $7, $8, $9, $10, 'journal', $11)`,
            [
              entry.business_id,
              line.branch_id ?? reversalBranchId,
              today,
              line.account_id,
              newVoucherId,
              debit,
              credit,
              newBalance,
              `Reversal of ${entry.voucher_number}`,
              voucherNumber,
              voucherNumber,
            ]
          );
        }

        // Create journal entry metadata record for the reversing entry
        await query(
          `INSERT INTO journal_entries (
            business_id, branch_id, voucher_id, voucher_number, entry_date,
            narration, is_locked, is_reversing, reverses_entry_id,
            created_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, false, true, $7, CURRENT_TIMESTAMP)`,
          [
            entry.business_id,
            reversalBranchId,
            newVoucherId,
            voucherNumber,
            today,
            `Automatic reversal of entry ${entry.voucher_number || entry.reverses_entry_id.substring(0, 8)}`,
            entry.reverses_entry_id,
          ]
        );

        processedCount++;
      } catch (error: any) {
        errors.push(`Error processing entry ${entry.voucher_id}: ${error.message}`);
        console.error(`Error processing reversing entry ${entry.voucher_id}:`, error);
      }
    }

    await client.query('COMMIT');

    return NextResponse.json({
      message: `Processed ${processedCount} reversing entries`,
      processed_count: processedCount,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('Error processing reversing entries:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}

/**
 * GET /api/cron/process-reversing-entries
 * Get list of pending reversing entries (for debugging/monitoring)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = searchParams.get('business_id');
    const limit = parseInt(searchParams.get('limit') || '50');

    let sql = `
      SELECT 
        id, business_id, voucher_id, voucher_number, 
        reversal_date, reverses_entry_id, created_at
      FROM journal_entries
      WHERE is_reversing = true
        AND reversal_date >= CURRENT_DATE
        AND reverses_entry_id IS NOT NULL
    `;

    const params: any[] = [];
    if (businessId) {
      sql += ` AND business_id = $1`;
      params.push(businessId);
    }

    sql += ` ORDER BY reversal_date ASC LIMIT $${params.length + 1}`;
    params.push(limit);

    const entries = await queryRows(sql, params);

    return NextResponse.json({ entries, count: entries.length });
  } catch (error: any) {
    console.error('Error fetching pending reversing entries:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

