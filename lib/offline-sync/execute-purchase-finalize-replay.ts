import type { PoolClient } from 'pg';
import {
  createPurchaseInTransaction,
  PurchaseCreateServiceError,
  validatePurchaseGstPayload,
  type CreatePurchaseInput,
} from '@/lib/purchases/purchase-create-service';
import type { IdempotentReplayContext, ReplayExecutorResult } from '@/lib/offline-sync/with-idempotent-replay';

const GST_TOLERANCE = 0.05;

/**
 * Offline replay: finalize purchase (create + stock + ledger) idempotently.
 * Uses existing purchase-create-service — no duplicated accounting logic.
 */
export async function executePurchaseFinalizeReplay(
  client: PoolClient,
  ctx: IdempotentReplayContext
): Promise<ReplayExecutorResult> {
  const payload = ctx.requestPayload as unknown as CreatePurchaseInput & {
    status?: string;
    business_id?: string;
    created_by?: string;
  };

  const body: CreatePurchaseInput = {
    ...payload,
    business_id: ctx.businessId,
    created_by: ctx.userId,
    status: 'final',
    items: Array.isArray(payload.items) ? payload.items : [],
  };

  if (!body.bill_date || body.items.length === 0) {
    return {
      ok: false,
      kind: 'failed',
      message: 'bill_date and items are required for purchase.finalize',
      permanent: true,
    };
  }

  const gstCheck = validatePurchaseGstPayload(body);
  if (!gstCheck.ok) {
    return {
      ok: false,
      kind: 'manual_review',
      message: gstCheck.reason,
      details: {
        server_totals: gstCheck.serverTotals,
        client_totals: gstCheck.clientTotals,
        gst_conflict: true,
      },
    };
  }

  try {
    const result = await createPurchaseInTransaction(client, body);
    const purchaseId = String(result.purchase.id);

    return {
      ok: true,
      response: {
        purchase: result.purchase,
        purchase_id: purchaseId,
        grand_total: result.grandTotal,
        subtotal: result.subtotal,
        tax_total: result.taxTotal,
        cgst_total: result.cgstTotal,
        sgst_total: result.sgstTotal,
        igst_total: result.igstTotal,
        replay_action: 'purchase.finalize',
      },
      entityType: 'purchase',
      entityId: purchaseId,
    };
  } catch (error) {
    if (error instanceof PurchaseCreateServiceError) {
      const gstConflict =
        error.code === 'GST_PERIOD_FILED' ||
        error.message.toLowerCase().includes('gst');

      if (gstConflict) {
        return {
          ok: false,
          kind: 'manual_review',
          message: error.message,
          details: { code: error.code, gst_conflict: true },
        };
      }

      const permanent =
        error.statusCode === 400 ||
        error.statusCode === 403 ||
        error.code === 'VALIDATION_ERROR' ||
        error.code === 'SUPPLIER_INVALID' ||
        error.code === 'PURCHASE_GOODS_LINE_UNLINKED';

      return {
        ok: false,
        kind: 'failed',
        message: error.message,
        permanent,
      };
    }

    if (error instanceof Error && error.name === 'PurchaseStockError') {
      return {
        ok: false,
        kind: 'failed',
        message: error.message,
        permanent: false,
      };
    }

    return {
      ok: false,
      kind: 'failed',
      message: error instanceof Error ? error.message : 'Purchase finalize failed',
      permanent: false,
    };
  }
}

export { GST_TOLERANCE };
