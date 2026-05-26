import type { PoolClient } from 'pg';
import {
  createInvoiceInTransaction,
  InvoiceCreateServiceError,
  validateInvoiceGstPayload,
  type CreateInvoiceInput,
} from '@/lib/invoices/invoice-create-service';
import { isOfflineTempInvoiceNumber } from '@/lib/offline/invoicing/offline-invoice-number';
import { findMappingByOfflineRef } from '@/lib/offline-sync/invoice-number-map-repository';
import { findReplayLog } from '@/lib/offline-sync/replay-log-repository';
import type { IdempotentReplayContext, ReplayExecutorResult } from '@/lib/offline-sync/with-idempotent-replay';
import { getStateCode } from '@/lib/invoices/validate-invoice-gst-payload';

/**
 * Offline replay: finalize sales invoice (create + stock + ledger) idempotently.
 * Server assigns legal invoice number; offline TMP reference is mapped for audit.
 */
export async function executeSalesFinalizeReplay(
  client: PoolClient,
  ctx: IdempotentReplayContext
): Promise<ReplayExecutorResult> {
  const payload = ctx.requestPayload as unknown as CreateInvoiceInput & {
    status?: string;
    business_id?: string;
    created_by?: string;
    offline_reference_number?: string;
  };

  const offlineRef =
    payload.offline_reference_number?.trim() ||
    (isOfflineTempInvoiceNumber(payload.invoice_number)
      ? String(payload.invoice_number).trim()
      : null);

  if (offlineRef) {
    const existingMap = await findMappingByOfflineRef(client, ctx.businessId, offlineRef);
    if (existingMap) {
      const inv = await client.query(`SELECT * FROM invoices WHERE id = $1`, [
        existingMap.invoice_id,
      ]);
      if (inv.rows[0]) {
        return {
          ok: true,
          response: {
            invoice: inv.rows[0],
            invoice_id: existingMap.invoice_id,
            invoice_number: existingMap.final_invoice_number,
            offline_reference_number: offlineRef,
            final_invoice_number: existingMap.final_invoice_number,
            replay_action: 'sales.finalize',
            duplicate_mapping: true,
          },
          entityType: 'invoice',
          entityId: existingMap.invoice_id,
        };
      }
    }
  }

  const body: CreateInvoiceInput = {
    ...payload,
    business_id: ctx.businessId,
    created_by: ctx.userId,
    status: 'final',
    items: Array.isArray(payload.items) ? payload.items : [],
    offline_reference_number: offlineRef,
    invoice_number: undefined,
  };

  if (!body.invoice_date || body.items.length === 0) {
    return {
      ok: false,
      kind: 'failed',
      message: 'invoice_date and items are required for sales.finalize',
      permanent: true,
    };
  }

  const businessRes = await client.query(
    `SELECT state_code, state FROM businesses WHERE id = $1`,
    [ctx.businessId]
  );
  const business = businessRes.rows[0] as { state_code?: string; state?: string } | undefined;
  const businessStateCode =
    business?.state_code || getStateCode(business?.state || '');

  const gstCheck = validateInvoiceGstPayload(body, businessStateCode);
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

  const replayRow = await findReplayLog(ctx.businessId, ctx.idempotencyKey, client);

  try {
    const result = await createInvoiceInTransaction(client, body, {
      forceServerInvoiceNumber: true,
      replayLogId: replayRow?.id ?? null,
      deviceId: ctx.deviceId ?? null,
    });

    return {
      ok: true,
      response: {
        invoice: result.invoice,
        invoice_id: result.invoiceId,
        invoice_number: result.invoiceNumber,
        offline_reference_number: result.offlineReferenceNumber,
        final_invoice_number: result.invoiceNumber,
        grand_total: result.grandTotal,
        subtotal: result.subtotal,
        tax_total: result.taxTotal,
        cgst_total: result.cgstTotal,
        sgst_total: result.sgstTotal,
        igst_total: result.igstTotal,
        replay_action: 'sales.finalize',
      },
      entityType: 'invoice',
      entityId: result.invoiceId,
    };
  } catch (error) {
    if (error instanceof InvoiceCreateServiceError) {
      const gstConflict =
        error.code === 'GST_PERIOD_FILED' ||
        error.message.toLowerCase().includes('gst');

      if (
        gstConflict ||
        error.code === 'STOCK_INSUFFICIENT' ||
        error.code === 'DUPLICATE_INVOICE_NUMBER' ||
        error.code === 'PRODUCT_DELETED' ||
        error.code === 'CUSTOMER_NOT_FOUND'
      ) {
        const manualReview =
          gstConflict ||
          error.code === 'STOCK_INSUFFICIENT' ||
          error.code === 'DUPLICATE_INVOICE_NUMBER' ||
          error.code === 'PRODUCT_DELETED';

        if (manualReview) {
          return {
            ok: false,
            kind: 'manual_review',
            message: error.message,
            details: { code: error.code, ...(error.details ?? {}) },
          };
        }
      }

      const permanent =
        error.statusCode === 400 ||
        error.statusCode === 403 ||
        error.code === 'VALIDATION_ERROR';

      return {
        ok: false,
        kind: 'failed',
        message: error.message,
        permanent,
      };
    }

    return {
      ok: false,
      kind: 'failed',
      message: error instanceof Error ? error.message : 'Sales finalize failed',
      permanent: false,
    };
  }
}
