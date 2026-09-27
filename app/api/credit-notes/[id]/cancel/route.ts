import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { getSessionScopedBusinessId, getBusinessIdFromRequest, getUserIdFromRequest } from '@/lib/auth-helpers';
import { adjustBranchItemStock, refreshItemGlobalStockFromBranches } from '@/lib/branch-stock';
import { reverseVoucherLedgerEntries } from '@/lib/ledger-reversal';
import { recomputeInvoiceBalance } from '@/lib/invoices/invoice-balance';

export const dynamic = 'force-dynamic';

/**
 * PATCH /api/credit-notes/[id]/cancel
 * Cancels a credit note: takes returned goods back out of stock, reverses its ledger voucher,
 * restores the customer and invoice balances. The number stays in the series as cancelled.
 */
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const body = await request.json().catch(() => ({}));
  const reason = String(body?.reason || '').trim();
  const userId = getUserIdFromRequest(request, body) || body?.cancelled_by;
  const businessId = getSessionScopedBusinessId(request) ?? getBusinessIdFromRequest(request, body);

  if (!businessId || !userId) {
    return NextResponse.json({ error: 'business_id and user_id are required' }, { status: 400 });
  }
  if (!reason) {
    return NextResponse.json({ error: 'A cancellation reason is required' }, { status: 400 });
  }

  const pool = getPool();
  const client = await pool.connect();
  try {
    const cnRes = await client.query(
      `SELECT * FROM credit_notes WHERE id = $1 AND business_id = $2`,
      [params.id, businessId]
    );
    const cn = cnRes.rows[0];
    if (!cn) return NextResponse.json({ error: 'Credit note not found' }, { status: 404 });
    if (cn.status === 'cancelled') {
      return NextResponse.json({ error: 'Credit note is already cancelled' }, { status: 409 });
    }

    try {
      await authorize(userId, 'credit_notes', 'cancel', { businessId, branchId: cn.branch_id, resourceId: cn.id });
    } catch (error) {
      if (error instanceof AuthorizationError) return error.toNextResponse();
      throw error;
    }

    const { assertGstPeriodNotFiledForDocumentDate } = await import('@/lib/gst/gst-filing');
    try {
      await assertGstPeriodNotFiledForDocumentDate(businessId, cn.branch_id, cn.credit_note_date, 'cancel credit note');
    } catch (error: any) {
      return NextResponse.json(
        { error: error.message || 'GST period is filed', code: 'GST_PERIOD_FILED' },
        { status: 403 }
      );
    }
    const { assertPeriodNotLocked } = await import('@/lib/period-lock-utils');
    try {
      await assertPeriodNotLocked(businessId, cn.branch_id, cn.credit_note_date, 'credit note');
    } catch (error: any) {
      return NextResponse.json({ error: error.message || 'Period is locked', code: 'PERIOD_LOCKED' }, { status: 403 });
    }

    await client.query('BEGIN');

    const { isWarehouseModeEnabled } = await import('@/lib/warehouse-mode');
    const warehouseModeEnabled = await isWarehouseModeEnabled(businessId);

    const lines = await client.query(
      `SELECT cni.item_id, cni.qty, cni.location_id, i.item_type
         FROM credit_note_items cni
         LEFT JOIN items i ON i.id = cni.item_id
        WHERE cni.credit_note_id = $1`,
      [cn.id]
    );
    for (const line of lines.rows) {
      if (!line.item_id || (line.item_type || 'goods') !== 'goods') continue;
      const qty = Number(line.qty) || 0;
      if (qty <= 0) continue;
      if (warehouseModeEnabled && line.location_id) {
        await client.query(
          `UPDATE location_stock SET current_stock_qty = current_stock_qty - $3, last_updated = CURRENT_TIMESTAMP
            WHERE location_id = $1 AND item_id = $2`,
          [line.location_id, line.item_id, qty]
        );
      } else if (cn.branch_id) {
        await adjustBranchItemStock(client, businessId, cn.branch_id, line.item_id, -qty);
        await refreshItemGlobalStockFromBranches(client, businessId, line.item_id);
      }
      await client.query(
        `INSERT INTO stock_movements (business_id, item_id, location_id, type, quantity, reference_type, reference_id, notes)
         VALUES ($1, $2, $3, 'out', $4, 'credit_note_cancel', $5, $6)`,
        [businessId, line.item_id, line.location_id || null, qty, cn.id, `Cancelled credit note ${cn.credit_note_number}`]
      );
    }

    await reverseVoucherLedgerEntries(client, {
      businessId,
      voucherType: 'credit_note',
      voucherId: cn.id,
      reason: `Credit note ${cn.credit_note_number} cancelled`,
    });

    if (cn.customer_id) {
      await client.query(
        `UPDATE customers SET current_balance = current_balance + $1, updated_at = CURRENT_TIMESTAMP
          WHERE id = $2 AND business_id = $3`,
        [Number(cn.grand_total) || 0, cn.customer_id, businessId]
      );
    }

    const updated = await client.query(
      `UPDATE credit_notes
          SET status = 'cancelled', cancelled_at = CURRENT_TIMESTAMP, cancelled_by = $1,
              cancellation_reason = $2, updated_at = CURRENT_TIMESTAMP
        WHERE id = $3 AND business_id = $4
        RETURNING *`,
      [userId, reason, cn.id, businessId]
    );

    if (cn.invoice_id) {
      await recomputeInvoiceBalance(client, cn.invoice_id, businessId);
    }

    await client.query('COMMIT');
    return NextResponse.json({ creditNote: updated.rows[0] });
  } catch (error: any) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error cancelling credit note:', error);
    return NextResponse.json({ error: 'Failed to cancel credit note', details: error.message }, { status: 500 });
  } finally {
    client.release();
  }
}
