import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { getAuthenticatedUserId, getSessionScopedBusinessId } from '@/lib/auth-helpers';
import { cancelFinalPurchase, PurchaseCancelError } from '@/lib/purchases/cancel-purchase';

export const dynamic = 'force-dynamic';

/**
 * POST /api/purchases/[id]/cancel  { reason?: string }
 * FINAL -> CANCELLED. Postings are reversed, stock received is taken back out, advances are
 * released; the bill stays visible as cancelled and can no longer be paid or finalised.
 * A bill with live payments is refused (409 PURCHASE_HAS_PAYMENTS); see cancelFinalPurchase.
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const purchaseId = params.id;
  try {
    let body: Record<string, unknown> = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }
    const userId = getAuthenticatedUserId(request);
    const businessScope = getSessionScopedBusinessId(request);
    if (!userId || !businessScope) {
      return NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 });
    }
    const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 500) || null : null;

    const pool = getPool();
    const purchase = (
      await pool.query(
        `SELECT id, business_id, branch_id, status, bill_date FROM purchases
          WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL`,
        [purchaseId, businessScope]
      )
    ).rows[0];
    if (!purchase) return NextResponse.json({ error: 'Purchase not found' }, { status: 404 });

    try {
      await authorize(userId, 'purchases', 'delete', {
        businessId: purchase.business_id,
        branchId: purchase.branch_id,
        resourceId: purchaseId,
      });
    } catch (error) {
      if (error instanceof AuthorizationError) return error.toNextResponse();
      throw error;
    }

    if (purchase.status === 'cancelled') {
      return NextResponse.json({ error: 'Purchase is already cancelled', code: 'PURCHASE_ALREADY_CANCELLED' }, { status: 409 });
    }
    if (purchase.status !== 'final') {
      return NextResponse.json(
        { error: 'Only a final purchase can be cancelled; delete the draft instead', code: 'PURCHASE_NOT_FINAL' },
        { status: 400 }
      );
    }

    const { assertGstPeriodNotFiledForDocumentDate } = await import('@/lib/gst/gst-filing');
    const { assertPeriodNotLocked } = await import('@/lib/period-lock-utils');
    try {
      await assertGstPeriodNotFiledForDocumentDate(purchase.business_id, purchase.branch_id, purchase.bill_date, 'cancel purchase');
    } catch (error: any) {
      return NextResponse.json({ error: error.message, code: 'GST_PERIOD_FILED' }, { status: 403 });
    }
    try {
      await assertPeriodNotLocked(purchase.business_id, purchase.branch_id, purchase.bill_date, 'purchase cancellation');
    } catch (error: any) {
      return NextResponse.json({ error: error.message, code: 'PERIOD_LOCKED' }, { status: 403 });
    }

    const { isWarehouseModeEnabled } = await import('@/lib/warehouse-mode');
    const warehouseModeEnabled = await isWarehouseModeEnabled(purchase.business_id);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await cancelFinalPurchase(client, {
        businessId: purchase.business_id,
        purchaseId,
        userId,
        reason,
        warehouseModeEnabled,
      });
      await client.query('COMMIT');
      return NextResponse.json({ success: true, ...result });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      if (error instanceof PurchaseCancelError) {
        return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
      }
      if ((error as { hint?: string })?.hint === 'LEDGER_PERIOD_LOCKED' || /locked period/i.test((error as Error)?.message || '')) {
        return NextResponse.json({ error: (error as Error).message, code: 'PERIOD_LOCKED' }, { status: 403 });
      }
      throw error;
    } finally {
      client.release();
    }
  } catch (error: any) {
    console.error('Error cancelling purchase:', error);
    return NextResponse.json({ error: 'Failed to cancel purchase', details: error.message }, { status: 500 });
  }
}
