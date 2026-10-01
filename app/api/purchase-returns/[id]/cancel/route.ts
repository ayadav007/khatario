import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { getBusinessIdFromRequest, getUserIdFromRequest } from '@/lib/auth-helpers';
import { reverseVoucherLedgerEntries } from '@/lib/ledger-reversal';
import { movePurchaseReturnStock } from '@/lib/purchases/purchase-return-stock';
import { recostAfterStockChange, stockItemsForDocument } from '@/lib/inventory/fifo-recost';

export const dynamic = 'force-dynamic';

/**
 * POST /api/purchase-returns/[id]/cancel
 * Cancels a purchase return: restores stock, posts mirror ledger lines (so the debit note's
 * ITC reversal and payable reduction net to zero) and restores supplier and bill balances.
 * Body: { reason }
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const userId = getUserIdFromRequest(request);
  if (!userId) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  const body = await request.json().catch(() => ({} as Record<string, unknown>));
  const businessId = getBusinessIdFromRequest(request, body);
  if (!businessId) return NextResponse.json({ error: 'business_id is required' }, { status: 400 });
  const reason = typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim() : null;
  if (!reason) {
    return NextResponse.json({ error: 'A cancellation reason is required', code: 'REASON_REQUIRED' }, { status: 400 });
  }

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const res = await client.query(
      `SELECT * FROM purchase_returns WHERE id = $1 AND business_id = $2 FOR UPDATE`,
      [params.id, businessId]
    );
    const pr = res.rows[0];
    if (!pr) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Purchase return not found' }, { status: 404 });
    }
    if (pr.status === 'cancelled') {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Purchase return is already cancelled', code: 'ALREADY_CANCELLED' }, { status: 409 });
    }

    try {
      await authorize(userId, 'purchases', 'delete', {
        branchId: pr.branch_id,
        businessId,
        resourceId: pr.id,
      });
    } catch (error) {
      await client.query('ROLLBACK');
      if (error instanceof AuthorizationError) return error.toNextResponse();
      throw error;
    }

    const returnDate = String(pr.return_date instanceof Date ? pr.return_date.toISOString() : pr.return_date).slice(0, 10);
    const { assertGstPeriodNotFiledForDocumentDate } = await import('@/lib/gst/gst-filing');
    try {
      await assertGstPeriodNotFiledForDocumentDate(businessId, pr.branch_id, returnDate, 'cancel purchase return');
    } catch (error: any) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        {
          error: `${error.message || 'GST period is filed'}. Record a new purchase bill or debit note in the current period instead.`,
          code: 'GST_PERIOD_FILED',
        },
        { status: 403 }
      );
    }
    const { assertPeriodNotLocked } = await import('@/lib/period-lock-utils');
    try {
      await assertPeriodNotLocked(businessId, pr.branch_id, returnDate, 'purchase return');
    } catch (error: any) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: error.message || 'Period is locked', code: 'PERIOD_LOCKED' }, { status: 403 });
    }

    const moves = await client.query(
      `SELECT item_id, location_id, SUM(quantity)::float8 AS qty
         FROM stock_movements
        WHERE business_id = $1 AND reference_type = 'purchase_return' AND reference_id = $2 AND type = 'out'
        GROUP BY item_id, location_id`,
      [businessId, pr.id]
    );
    for (const m of moves.rows) {
      await movePurchaseReturnStock(client, {
        businessId,
        branchId: pr.branch_id,
        warehouseId: m.location_id,
        itemId: m.item_id,
        qty: Number(m.qty),
        direction: 'in',
        returnId: pr.id,
        referenceType: 'purchase_return_cancel',
        notes: `Cancelled return ${pr.return_number}`,
      });
    }

    await reverseVoucherLedgerEntries(client, {
      businessId,
      voucherType: 'purchase_return',
      voucherId: pr.id,
      reason: `Purchase return ${pr.return_number} cancelled`,
      entryDate: returnDate,
    });

    const total = Number(pr.grand_total) || 0;
    if (pr.supplier_id && total) {
      await client.query(
        `UPDATE suppliers SET current_balance = current_balance + $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
        [total, pr.supplier_id]
      );
    }
    if (pr.purchase_id && total) {
      await client.query(
        `UPDATE purchases SET balance_amount = balance_amount + $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
        [total, pr.purchase_id]
      );
    }

    const updated = await client.query(
      `UPDATE purchase_returns
          SET status = 'cancelled', cancelled_at = CURRENT_TIMESTAMP, cancelled_by = $2,
              cancellation_reason = $3, itc_reversed = false, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
        RETURNING *`,
      [pr.id, userId, reason]
    );
    await recostAfterStockChange(client, businessId, await stockItemsForDocument(client, 'purchase_return', pr.id));
    await client.query('COMMIT');

    const { logActivity, getClientIP, getUserAgent } = await import('@/lib/activity-logger');
    await logActivity({
      business_id: businessId,
      user_id: userId,
      action_type: 'cancel',
      module: 'purchase_returns',
      entity_id: pr.id,
      entity_type: 'purchase_return',
      description: `Cancelled purchase return ${pr.return_number}: ${reason}`,
      ip_address: getClientIP(request),
      user_agent: getUserAgent(request),
    });

    return NextResponse.json({ purchaseReturn: updated.rows[0] });
  } catch (error: any) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error cancelling purchase return:', error);
    return NextResponse.json({ error: 'Failed to cancel purchase return', details: error.message }, { status: 500 });
  } finally {
    client.release();
  }
}
