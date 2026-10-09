import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { authorize, AuthorizationError } from '@/lib/authorization';
import {
  getAuthenticatedUserId,
  getBusinessIdFromRequest,
  getSessionScopedBusinessId,
  getUserIdFromRequest,
} from '@/lib/auth-helpers';
import { calculateCreditMetrics, getCreditWarningMessage } from '@/lib/credit-utils';
import { checkAndSendCreditAlerts } from '@/lib/credit-alerts';
import { shouldUseSoftDelete } from '@/lib/soft-delete-entitlements';
import { cancelFinalPurchase, PurchaseCancelError } from '@/lib/purchases/cancel-purchase';
import { deleteDraftPurchase } from '@/lib/purchases/delete-draft-purchase';
import { purchaseReturnLineKey } from '@/lib/purchases/purchase-return-lines';

export const dynamic = 'force-dynamic';

/**
 * GET /api/purchases/[id]
 * Fetch a single purchase with its items
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const purchaseId = params.id;

  try {
    // Get user_id from query params (required for authorization)
    const userId = getUserIdFromRequest(request);
    
    if (!userId) {
      return NextResponse.json(
        { error: 'user_id is required for authorization' },
        { status: 400 }
      );
    }

    const businessScope = getBusinessIdFromRequest(request);
    if (!businessScope) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    const pool = getPool();

    // Tenant-scoped: only rows for JWT/session active business
    const purchaseResult = await pool.query(
      `SELECT 
        p.*,
        s.name as supplier_name,
        s.phone as supplier_phone,
        s.gstin as supplier_gstin
      FROM purchases p
      LEFT JOIN suppliers s ON p.supplier_id = s.id
      WHERE p.id = $1 AND p.business_id = $2 AND p.deleted_at IS NULL`,
      [purchaseId, businessScope]
    );

    if (purchaseResult.rows.length === 0) {
      return NextResponse.json(
        { error: 'Purchase not found' },
        { status: 404 }
      );
    }

    const purchase = purchaseResult.rows[0];

    // AUTHORIZATION: Check read permission with branch context
    try {
      await authorize(userId, 'purchases', 'read', { 
        branchId: purchase.branch_id,
        businessId: purchase.business_id,
        resourceId: purchaseId,
      });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    // Fetch purchase items
    const itemsResult = await pool.query(
      `SELECT
        pi.*,
        i.name AS catalog_item_name,
        i.code AS catalog_item_code
      FROM purchase_items pi
      LEFT JOIN items i ON pi.item_id = i.id
      WHERE pi.purchase_id = $1
      ORDER BY pi.id`,
      [purchaseId]
    );

    purchase.items = itemsResult.rows;

    const returned = await pool.query(
      `SELECT pri.item_id, pri.description, SUM(pri.qty)::float8 AS qty
         FROM purchase_return_items pri
         JOIN purchase_returns pr ON pr.id = pri.return_id
        WHERE pr.purchase_id = $1 AND pr.business_id = $2
          AND COALESCE(pr.status, 'final') <> 'cancelled'
        GROUP BY pri.item_id, pri.description`,
      [purchaseId, purchase.business_id]
    );
    const alreadyReturned = new Map<string, number>();
    for (const row of returned.rows) {
      const key = purchaseReturnLineKey(row.item_id, row.description);
      alreadyReturned.set(key, (alreadyReturned.get(key) || 0) + Number(row.qty));
    }
    for (const item of purchase.items) {
      const key = purchaseReturnLineKey(item.item_id, item.item_name);
      item.returned_qty = alreadyReturned.get(key) || 0;
    }

    // PHASE 4.3: Calculate credit metrics for supplier (if applicable)
    let creditMetrics = null;
    let creditWarning = null;
    
    if (purchase.supplier_id) {
      try {
        const supplierData = await pool.query(
          `SELECT credit_limit, current_balance FROM suppliers WHERE id = $1 AND business_id = $2`,
          [purchase.supplier_id, purchase.business_id]
        );

        if (supplierData.rows.length > 0) {
          const creditLimit = supplierData.rows[0].credit_limit;
          const currentBalance = supplierData.rows[0].current_balance;
          
          // Calculate current credit metrics
          const currentMetrics = calculateCreditMetrics(creditLimit, currentBalance);
          
          creditMetrics = {
            current: currentMetrics,
          };
          
          // Get warning message
          creditWarning = getCreditWarningMessage(
            currentMetrics,
            'supplier'
          );

          // PHASE 5.4: Check and send credit alerts (async, non-blocking)
          checkAndSendCreditAlerts(
            purchase.business_id,
            'supplier',
            purchase.supplier_id,
            creditLimit,
            currentBalance,
            currentMetrics,
            'purchase',
            purchase.id
          ).catch(err => console.error('Error sending credit alert:', err));
        }
      } catch (creditError) {
        // Don't fail purchase fetch if credit calculation fails
        console.error('Error calculating credit metrics:', creditError);
      }
    }

    return NextResponse.json({ 
      purchase,
      credit_metrics: creditMetrics,
      credit_warning: creditWarning,
    });
  } catch (error: any) {
    console.error('Error fetching purchase:', error);
    return NextResponse.json(
      { error: 'Failed to fetch purchase', details: error.message },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/purchases/[id]
 * - Final bill: cancelled through reversal (lib/purchases/cancel-purchase.ts); nothing posted is
 *   deleted. With soft delete the cancelled bill is also hidden from lists, as before.
 * - Draft bill: removed (soft or hard delete); vouchers of its payments/TDS are reversed.
 * - Cancelled bill: hidden with soft delete only; it is never hard-deleted.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const purchaseId = params.id;

  try {
    let body: Record<string, unknown> | undefined;
    try {
      body = await request.json();
    } catch {
      body = undefined;
    }
    const userId = getAuthenticatedUserId(request);
    const businessScope = getSessionScopedBusinessId(request);
    if (!userId || !businessScope) {
      return NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 });
    }
    const reason = typeof body?.reason === 'string' ? (body.reason as string).trim().slice(0, 500) || null : null;

    const pool = getPool();
    const purchaseResult = await pool.query(
      `SELECT id, business_id, branch_id, status, bill_date, bill_number
         FROM purchases WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL`,
      [purchaseId, businessScope]
    );
    const purchase = purchaseResult.rows[0];
    if (!purchase) {
      return NextResponse.json({ error: 'Purchase not found' }, { status: 404 });
    }

    try {
      await authorize(userId, 'purchases', 'delete', {
        businessId: purchase.business_id,
        branchId: purchase.branch_id,
        resourceId: purchaseId,
      });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    if (purchase.status === 'final') {
      const { assertGstPeriodNotFiledForDocumentDate } = await import('@/lib/gst/gst-filing');
      const { assertPeriodNotLocked } = await import('@/lib/period-lock-utils');
      try {
        await assertGstPeriodNotFiledForDocumentDate(purchase.business_id, purchase.branch_id, purchase.bill_date, 'delete purchase');
      } catch (error: any) {
        return NextResponse.json({ error: error.message, code: 'GST_PERIOD_FILED' }, { status: 403 });
      }
      try {
        await assertPeriodNotLocked(purchase.business_id, purchase.branch_id, purchase.bill_date, 'purchase deletion');
      } catch (error: any) {
        return NextResponse.json({ error: error.message, code: 'PERIOD_LOCKED' }, { status: 403 });
      }
    }

    const useSoftDeletePurchase = await shouldUseSoftDelete(businessScope);
    const { isWarehouseModeEnabled } = await import('@/lib/warehouse-mode');
    const warehouseModeEnabled = await isWarehouseModeEnabled(purchase.business_id);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      if (purchase.status === 'final') {
        await cancelFinalPurchase(client, {
          businessId: purchase.business_id,
          purchaseId,
          userId,
          reason: reason || 'Deleted',
          warehouseModeEnabled,
        });
        if (useSoftDeletePurchase) {
          await client.query(
            `UPDATE purchases SET deleted_at = CURRENT_TIMESTAMP WHERE id = $1 AND business_id = $2`,
            [purchaseId, purchase.business_id]
          );
        }
        await client.query('COMMIT');
        return NextResponse.json({
          success: true,
          cancelled: true,
          message: 'Purchase cancelled; its postings were reversed',
        });
      }

      if (purchase.status === 'cancelled') {
        if (!useSoftDeletePurchase) {
          await client.query('ROLLBACK');
          return NextResponse.json(
            { error: 'Cancelled bills are kept for the audit trail', code: 'PURCHASE_CANCELLED' },
            { status: 409 }
          );
        }
        await client.query(
          `UPDATE purchases SET deleted_at = CURRENT_TIMESTAMP WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL`,
          [purchaseId, purchase.business_id]
        );
        await client.query('COMMIT');
        return NextResponse.json({ success: true, message: 'Purchase deleted successfully' });
      }

      const result = await deleteDraftPurchase(client, {
        businessId: purchase.business_id,
        purchaseId,
        userId,
        softDelete: useSoftDeletePurchase,
      });
      await client.query('COMMIT');
      return NextResponse.json({
        success: true,
        message: 'Purchase deleted successfully',
        supplier_balance_restored: result.supplierRestored,
        mode: result.mode,
      });
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
    console.error('Error deleting purchase:', error);
    return NextResponse.json(
      { error: 'Failed to delete purchase', details: error.message },
      { status: 500 }
    );
  }
}
