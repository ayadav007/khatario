import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import { query, queryOne, getPool } from '@/lib/db';
import { authorize, AuthorizationError } from '@/lib/authorization';

/**
 * POST /api/journal-entries/[id]/lock
 * Lock a journal entry to prevent editing/deleting
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const pool = getPool();
  const client = await pool.connect();

  try {
    const voucherId = params.id;
    const body = await request.json();
    const { business_id, lock_reason } = body;
    const userId = getUserIdFromRequest(request, body) || body.locked_by || request.headers.get('x-user-id');

    if (!business_id) {
      client.release();
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    if (!userId) {
      client.release();
      return NextResponse.json(
        { error: 'user_id (locked_by) is required for authorization' },
        { status: 400 }
      );
    }

    await client.query('BEGIN');

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
      await client.query('ROLLBACK');
      client.release();
      return NextResponse.json(
        { error: 'Journal entry not found' },
        { status: 404 }
      );
    }

    // AUTHORIZATION: Check lock permission (PBAC will check branch access, business ownership, is_locked status, period lock)
    // Note: Status validation is now handled by PBAC policy - removed inline checks
    try {
      await authorize(userId, 'journal', 'lock', {
        businessId: business_id,
        branchId: journalEntry.branch_id || null,
        resourceId: voucherId,
        entry_date: journalEntry.entry_date,
        resource: journalEntry,
      });
    } catch (error) {
      await client.query('ROLLBACK');
      client.release();
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    // Lock the entry
    await query(
      `UPDATE journal_entries 
       SET is_locked = true, 
           locked_at = CURRENT_TIMESTAMP,
           locked_by = $1,
           lock_reason = $2,
           updated_at = CURRENT_TIMESTAMP
       WHERE voucher_id = $3 AND business_id = $4`,
      [userId, lock_reason || null, voucherId, business_id]
    );

    await client.query('COMMIT');

    return NextResponse.json({ 
      message: 'Journal entry locked successfully',
      is_locked: true
    });
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('Error locking journal entry:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}

/**
 * DELETE /api/journal-entries/[id]/lock
 * Unlock a journal entry
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const pool = getPool();
  const client = await pool.connect();

  try {
    const voucherId = params.id;
    const { searchParams } = new URL(request.url);
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request) || request.headers.get('x-user-id');

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

    await client.query('BEGIN');

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
      await client.query('ROLLBACK');
      client.release();
      return NextResponse.json(
        { error: 'Journal entry not found' },
        { status: 404 }
      );
    }

    // AUTHORIZATION: Check unlock permission (PBAC will check branch access, business ownership, is_locked status, period lock)
    // Note: Status validation is now handled by PBAC policy - removed inline checks
    try {
      await authorize(userId, 'journal', 'unlock', {
        businessId: businessId,
        branchId: journalEntry.branch_id || null,
        resourceId: voucherId,
        entry_date: journalEntry.entry_date,
        resource: journalEntry,
      });
    } catch (error) {
      await client.query('ROLLBACK');
      client.release();
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    // Unlock the entry
    await query(
      `UPDATE journal_entries 
       SET is_locked = false, 
           locked_at = NULL,
           locked_by = NULL,
           lock_reason = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE voucher_id = $1 AND business_id = $2`,
      [voucherId, businessId]
    );

    await client.query('COMMIT');

    return NextResponse.json({ 
      message: 'Journal entry unlocked successfully',
      is_locked: false
    });
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('Error unlocking journal entry:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}

