import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { getAuthenticatedUserId, getSessionScopedBusinessId } from '@/lib/auth-helpers';
import { adjustBranchItemStock, refreshItemGlobalStockFromBranches } from '@/lib/branch-stock';
import { reverseVoucherLedgerEntries } from '@/lib/ledger-reversal';
import { recomputeInvoiceBalance } from '@/lib/invoices/invoice-balance';
import { recostAfterStockChange } from '@/lib/inventory/fifo-recost';
import { markGstReadinessStale } from '@/lib/gst/period-freshness';

export const dynamic = 'force-dynamic';

function isoDate(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${value.getFullYear()}-${month}-${day}`;
  }
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(String(value));
  return match ? match[1] : null;
}

/**
 * PATCH /api/debit-notes/[id]/cancel
 * Cancels a sales debit note. The note raises taxable value and output tax;
 * it is not a goods return. Cancellation reverses the ledger voucher and the
 * customer receivable. Stock is put back only for quantity this note actually
 * issued. A second call does not post another reversal. Actor and tenant come
 * from the session.
 */
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const body = await request.json().catch(() => ({}));
  const reason = String(body?.reason || '').trim();
  const userId = getAuthenticatedUserId(request);
  const businessId = getSessionScopedBusinessId(request);

  if (!businessId || !userId) {
    return NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 });
  }
  if (!reason) {
    return NextResponse.json({ error: 'A cancellation reason is required' }, { status: 400 });
  }

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const noteRes = await client.query(
      `SELECT * FROM debit_notes WHERE id = $1 AND business_id = $2 FOR UPDATE`,
      [params.id, businessId]
    );
    const note = noteRes.rows[0];
    if (!note) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Debit note not found' }, { status: 404 });
    }
    if (note.status === 'cancelled') {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: 'Debit note is already cancelled', code: 'DEBIT_NOTE_ALREADY_CANCELLED' },
        { status: 409 }
      );
    }

    try {
      await authorize(userId, 'debit_notes', 'cancel', {
        businessId,
        branchId: note.branch_id,
        resourceId: note.id,
        debit_note_date: note.debit_note_date,
        resource: note,
      });
    } catch (error) {
      await client.query('ROLLBACK');
      if (error instanceof AuthorizationError) return error.toNextResponse();
      throw error;
    }

    const { assertGstPeriodNotFiledForDocumentDate } = await import('@/lib/gst/gst-filing');
    try {
      await assertGstPeriodNotFiledForDocumentDate(businessId, note.branch_id, note.debit_note_date, 'cancel debit note');
    } catch (error: any) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: error.message || 'GST period is filed', code: 'GST_PERIOD_FILED' },
        { status: 403 }
      );
    }
    const { assertPeriodNotLocked } = await import('@/lib/period-lock-utils');
    try {
      await assertPeriodNotLocked(businessId, note.branch_id, note.debit_note_date, 'debit note');
    } catch (error: any) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: error.message || 'Period is locked', code: 'PERIOD_LOCKED' }, { status: 403 });
    }

    const issued = await client.query(
      `SELECT item_id, location_id, SUM(quantity)::float8 AS qty
         FROM stock_movements
        WHERE business_id = $1 AND reference_type = 'debit_note' AND reference_id = $2 AND type = 'out'
        GROUP BY item_id, location_id`,
      [businessId, note.id]
    );
    const restocked: string[] = [];
    for (const line of issued.rows) {
      const qty = Number(line.qty) || 0;
      if (!line.item_id || qty <= 0) continue;
      if (line.location_id) {
        await client.query(
          `UPDATE location_stock SET current_stock_qty = current_stock_qty + $3, last_updated = CURRENT_TIMESTAMP
            WHERE location_id = $1 AND item_id = $2`,
          [line.location_id, line.item_id, qty]
        );
      } else if (note.branch_id) {
        await adjustBranchItemStock(client, businessId, note.branch_id, line.item_id, qty);
        await refreshItemGlobalStockFromBranches(client, businessId, line.item_id);
      }
      await client.query(
        `INSERT INTO stock_movements (business_id, item_id, location_id, type, quantity, reference_type, reference_id, notes)
         VALUES ($1, $2, $3, 'in', $4, 'debit_note_cancel', $5, $6)`,
        [businessId, line.item_id, line.location_id || null, qty, note.id, `Cancelled debit note ${note.debit_note_number}`]
      );
      restocked.push(line.item_id);
    }

    await reverseVoucherLedgerEntries(client, {
      businessId,
      voucherType: 'debit_note',
      voucherId: note.id,
      reason: `Debit note ${note.debit_note_number} cancelled`,
      actorId: userId,
    });

    if (note.customer_id) {
      await client.query(
        `UPDATE customers SET current_balance = current_balance - $1, updated_at = CURRENT_TIMESTAMP
          WHERE id = $2 AND business_id = $3`,
        [Number(note.grand_total) || 0, note.customer_id, businessId]
      );
    }

    const updated = await client.query(
      `UPDATE debit_notes
          SET status = 'cancelled', cancelled_at = CURRENT_TIMESTAMP, cancelled_by = $1,
              cancellation_reason = $2, updated_at = CURRENT_TIMESTAMP
        WHERE id = $3 AND business_id = $4
        RETURNING *`,
      [userId, reason, note.id, businessId]
    );

    if (note.invoice_id) {
      await recomputeInvoiceBalance(client, note.invoice_id, businessId);
    }
    if (restocked.length > 0) {
      await recostAfterStockChange(client, businessId, restocked);
    }
    await markGstReadinessStale(client, businessId, {
      dates: [isoDate(note.debit_note_date)],
      monthly: ['gstr1', 'gstr3b'],
    });

    await client.query('COMMIT');
    return NextResponse.json({ debitNote: updated.rows[0] });
  } catch (error: any) {
    await client.query('ROLLBACK').catch(() => {});
    if (error?.hint === 'LEDGER_PERIOD_LOCKED' || /locked period/i.test(error?.message || '')) {
      return NextResponse.json({ error: error.message, code: 'PERIOD_LOCKED' }, { status: 403 });
    }
    console.error('Error cancelling debit note:', error);
    return NextResponse.json({ error: 'Failed to cancel debit note', details: error.message }, { status: 500 });
  } finally {
    client.release();
  }
}
