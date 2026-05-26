import type { PoolClient } from 'pg';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { enforceAccess, enforceAccessErrorResponse } from '@/lib/enforce-access';
import { FeatureKeys } from '@/lib/featureKeys';
import { applyPurchaseGoodsStockLine, PurchaseStockError } from '@/lib/purchase-goods-stock';
import { resolveCatalogItemIdForPurchase } from '@/lib/matching/resolve-catalog-item-for-purchase';
import { createCatalogItemFromAdHocPurchaseLine } from '@/lib/purchases/create-catalog-item-from-purchase-line';
import {
  getClosingStockLockedCutoffDate,
  assertDocumentDateNotBeforeLockedClosingStock,
  ClosingStockPeriodLockedError,
} from '@/lib/closing-stock-period-lock';
import {
  computePurchaseDocument,
  stateCodeFromGstin,
} from '@/lib/purchase-gst-calculator';

export class PurchaseCreateServiceError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public code?: string,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'PurchaseCreateServiceError';
  }
}

export interface CreatePurchaseInput {
  business_id: string;
  created_by: string;
  branch_id?: string;
  supplier_id?: string | null;
  bill_number?: string | null;
  bill_date: string;
  status?: 'draft' | 'final';
  items: Record<string, unknown>[];
  subtotal?: number;
  tax_total?: number;
  round_off?: number;
  grand_total?: number;
  paid_amount?: number;
  notes?: string | null;
  place_of_supply_state_code?: string | null;
  is_reverse_charge?: boolean;
  document_type?: string;
  port_code?: string | null;
  itc_eligible?: boolean;
  price_mode?: string;
  supplier_state_code?: string | null;
  invoice_number?: string | null;
  supplier_gstin?: string | null;
}

export interface CreatePurchaseResult {
  purchase: Record<string, unknown>;
  grandTotal: number;
  subtotal: number;
  taxTotal: number;
  cgstTotal: number;
  sgstTotal: number;
  igstTotal: number;
}

const STATE_NAME_MAP: Record<string, string> = {
  'andhra pradesh': '37',
  karnataka: '29',
  'tamil nadu': '33',
  maharashtra: '27',
  gujarat: '24',
  rajasthan: '08',
  'uttar pradesh': '09',
  'west bengal': '19',
  delhi: '07',
  telangana: '36',
};

function getStateCode(stateName: string): string {
  if (!stateName) return '';
  return STATE_NAME_MAP[stateName.trim().toLowerCase()] || '';
}

/**
 * Creates a purchase inside an existing transaction (no BEGIN/COMMIT).
 * Mirrors POST /api/purchases accounting path — used by offline replay.
 */
export async function createPurchaseInTransaction(
  client: PoolClient,
  body: CreatePurchaseInput
): Promise<CreatePurchaseResult> {
  const business_id = body.business_id;
  const created_by = body.created_by;
  const status = body.status ?? 'draft';
  const items = body.items;

  if (!business_id || !body.bill_date || !items?.length) {
    throw new PurchaseCreateServiceError(
      'business_id, bill_date, and items are required',
      400,
      'VALIDATION_ERROR'
    );
  }

  if (!created_by) {
    throw new PurchaseCreateServiceError('created_by is required', 400, 'VALIDATION_ERROR');
  }

  try {
    const cutoff = await getClosingStockLockedCutoffDate(business_id);
    assertDocumentDateNotBeforeLockedClosingStock(String(body.bill_date).slice(0, 10), cutoff);
  } catch (e) {
    if (e instanceof ClosingStockPeriodLockedError) {
      throw new PurchaseCreateServiceError(e.message, 409, 'CLOSING_STOCK_PERIOD_LOCKED', {
        cutoff: e.cutoffDate,
      });
    }
    throw e;
  }

  const { checkEmployeeAccessBoundary } = await import('@/lib/access-boundary');
  const accessCheck = await checkEmployeeAccessBoundary(created_by, 'portal');
  if (!accessCheck.allowed) {
    throw new PurchaseCreateServiceError(accessCheck.reason ?? 'Access denied', 403, 'ACCESS_DENIED');
  }

  const { resolveBranchId } = await import('@/lib/branch-helpers');
  let finalBranchId: string;
  try {
    finalBranchId = await resolveBranchId({
      branchId: body.branch_id,
      businessId: business_id,
    });
  } catch (error: unknown) {
    const err = error as { code?: string; message?: string };
    if (
      err.code === 'BRANCH_NOT_FOUND' ||
      err.code === 'BRANCH_BUSINESS_MISMATCH' ||
      err.code === 'BRANCH_INACTIVE' ||
      err.code === 'NO_DEFAULT_BRANCH'
    ) {
      throw new PurchaseCreateServiceError(err.message ?? 'Branch error', 400, err.code);
    }
    throw error;
  }

  try {
    await authorize(created_by, 'purchases', 'create', { branchId: finalBranchId });
  } catch (error) {
    if (error instanceof AuthorizationError) {
      throw new PurchaseCreateServiceError(error.message, 403, 'AUTHORIZATION_DENIED');
    }
    throw error;
  }

  const { isWarehouseModeEnabled } = await import('@/lib/warehouse-mode');
  const warehouseModeEnabled = await isWarehouseModeEnabled(business_id);

  const { assertGstPeriodNotFiledForDocumentDate } = await import('@/lib/gst/gst-filing');
  try {
    await assertGstPeriodNotFiledForDocumentDate(
      business_id,
      finalBranchId,
      body.bill_date,
      'save purchase'
    );
  } catch (error: unknown) {
    throw new PurchaseCreateServiceError(
      (error as Error).message || 'GST period is filed',
      403,
      'GST_PERIOD_FILED'
    );
  }

  const { assertPeriodNotLocked } = await import('@/lib/period-lock-utils');
  try {
    await assertPeriodNotLocked(business_id, finalBranchId, body.bill_date, 'purchase');
  } catch (error: unknown) {
    throw new PurchaseCreateServiceError(
      (error as Error).message || 'Period is locked',
      403,
      'PERIOD_LOCKED'
    );
  }

  const normalizedSupplierId =
    body.supplier_id != null && String(body.supplier_id).trim() !== ''
      ? String(body.supplier_id).trim()
      : null;

  if (normalizedSupplierId) {
    const supOk = await client.query(
      `SELECT id FROM suppliers WHERE id = $1 AND business_id = $2 AND (is_active IS NULL OR is_active = true)`,
      [normalizedSupplierId, business_id]
    );
    if (supOk.rows.length === 0) {
      throw new PurchaseCreateServiceError(
        'Supplier not found for this business',
        400,
        'SUPPLIER_INVALID'
      );
    }
  }

  try {
    await enforceAccess({
      businessId: business_id,
      userId: created_by,
      branchId: finalBranchId,
      feature: FeatureKeys.PURCHASE_MANAGEMENT,
      limitType: 'purchases',
      poolClient: client,
    });
  } catch (e) {
    const res = enforceAccessErrorResponse(e);
    if (res) {
      const json = await res.json().catch(() => ({}));
      throw new PurchaseCreateServiceError(
        (json as { error?: string }).error ?? 'Feature access denied',
        res.status,
        (json as { code?: string }).code
      );
    }
    throw e;
  }

  const businessRes = await client.query(
    'SELECT state_code, state FROM businesses WHERE id = $1',
    [business_id]
  );
  if (businessRes.rows.length === 0) {
    throw new PurchaseCreateServiceError('Business not found', 404, 'BUSINESS_NOT_FOUND');
  }
  const business = businessRes.rows[0];

  let supplierGstin: string | null = null;
  let supplierStateFromMaster: string | null = null;
  if (normalizedSupplierId) {
    const supplierRes = await client.query(
      'SELECT gstin, state_code FROM suppliers WHERE id = $1 AND business_id = $2',
      [normalizedSupplierId, business_id]
    );
    if (supplierRes.rows.length > 0) {
      supplierGstin = supplierRes.rows[0].gstin;
      supplierStateFromMaster = supplierRes.rows[0].state_code;
    }
  }

  const effectiveSupplierGstin =
    (typeof body.supplier_gstin === 'string' && body.supplier_gstin.trim()
      ? body.supplier_gstin.trim().toUpperCase()
      : null) || (supplierGstin ? String(supplierGstin).trim().toUpperCase() : null);

  const supplierStateResolved =
    (typeof body.supplier_state_code === 'string' && body.supplier_state_code.trim()
      ? body.supplier_state_code.trim().slice(0, 2)
      : null) ||
    (supplierStateFromMaster ? String(supplierStateFromMaster).trim().slice(0, 2) : '') ||
    stateCodeFromGstin(effectiveSupplierGstin || supplierGstin || undefined);

  const headerPriceMode = body.price_mode === 'inclusive' ? 'inclusive' : 'exclusive';
  const businessStateCode = business.state_code || getStateCode(business.state || '');
  const finalPlaceOfSupply = body.place_of_supply_state_code || businessStateCode;
  const supplierStateForGst =
    supplierStateResolved && String(supplierStateResolved).trim().length >= 2
      ? String(supplierStateResolved).trim().slice(0, 2)
      : String(finalPlaceOfSupply || businessStateCode || '')
          .trim()
          .slice(0, 2);

  const gstDoc = computePurchaseDocument(
    items.map((item) => ({
      quantity: Number(item.quantity) || 0,
      unit_price: Number(item.unit_price) || 0,
      discount_percent: Number(item.discount_percent) || 0,
      discount_amount: Number(item.discount_amount) || 0,
      discount_on_tax_inclusive: item.discount_on_tax_inclusive === true,
      tax_rate: Number(item.tax_rate) || 0,
      tax_mode: item.tax_mode as string | undefined,
      manual_cgst: item.manual_cgst as number | undefined,
      manual_sgst: item.manual_sgst as number | undefined,
      manual_igst: item.manual_igst as number | undefined,
    })),
    {
      supplierStateCode: supplierStateForGst || '',
      companyStateCode: businessStateCode || '',
      headerPriceMode,
    }
  );

  const finalSubtotal = body.subtotal !== undefined ? body.subtotal : gstDoc.subtotal;
  const finalTaxTotal = body.tax_total !== undefined ? body.tax_total : gstDoc.taxTotal;
  const finalRoundOff =
    typeof body.round_off === 'number' && isFinite(body.round_off) ? body.round_off : 0;
  const computedGrand = gstDoc.subtotal + gstDoc.taxTotal + finalRoundOff;
  const finalGrandTotal = body.grand_total !== undefined ? body.grand_total : computedGrand;
  const paid_amount = body.paid_amount ?? 0;
  const balanceAmount = finalGrandTotal - paid_amount;

  let paymentStatus: 'unpaid' | 'partially_paid' | 'paid' = 'unpaid';
  if (paid_amount <= 0) paymentStatus = 'unpaid';
  else if (balanceAmount <= 0) paymentStatus = 'paid';
  else paymentStatus = 'partially_paid';

  const invoiceNumberStored =
    (typeof body.invoice_number === 'string' && body.invoice_number.trim()
      ? body.invoice_number.trim()
      : null) || (body.bill_number ? String(body.bill_number).trim() : null);

  const purchaseResult = await client.query(
    `
    INSERT INTO purchases (
      business_id, branch_id, supplier_id, bill_number, bill_date,
      status, subtotal, tax_total, cgst_total, sgst_total, igst_total,
      round_off, grand_total, paid_amount, balance_amount, payment_status, notes,
      place_of_supply_state_code, is_reverse_charge, supplier_gstin,
      document_type, port_code, itc_eligible,
      price_mode, supplier_state_code, invoice_number
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)
    RETURNING *
    `,
    [
      business_id,
      finalBranchId,
      normalizedSupplierId,
      body.bill_number || null,
      body.bill_date,
      status,
      finalSubtotal,
      finalTaxTotal,
      gstDoc.cgstTotal,
      gstDoc.sgstTotal,
      gstDoc.igstTotal,
      finalRoundOff,
      finalGrandTotal,
      paid_amount,
      balanceAmount,
      paymentStatus,
      body.notes || null,
      finalPlaceOfSupply || null,
      body.is_reverse_charge ?? false,
      effectiveSupplierGstin,
      body.document_type ?? 'tax_invoice',
      body.port_code || null,
      body.itc_eligible !== false,
      headerPriceMode,
      supplierStateForGst || null,
      invoiceNumberStored,
    ]
  );

  const purchase = purchaseResult.rows[0];
  const uuidRe =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const computed = gstDoc.lineComputeds[i];
    const qty = Number(item.quantity) || 0;
    const lineIntent = item.item_type === 'service' ? 'service' : 'goods';
    const lineTaxMode =
      item.tax_mode === 'inclusive' || item.tax_mode === 'exclusive'
        ? item.tax_mode
        : headerPriceMode;
    const rawVariantId =
      typeof item.variant_id === 'string' && uuidRe.test(item.variant_id.trim())
        ? item.variant_id.trim()
        : null;
    const unitCostForStock = qty > 0 ? computed.taxableValue / qty : Number(item.unit_price) || 0;

    await client.query(
      `
      INSERT INTO purchase_items (
        purchase_id, item_id, variant_id, item_name, hsn_sac, quantity,
        unit, unit_price, discount_percent, discount_amount, discount_account_id, taxable_value,
        tax_rate, tax_mode, tax_amount, cgst_amount, sgst_amount, igst_amount, line_total,
        location_id, line_item_type
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
      `,
      [
        purchase.id,
        item.item_id || null,
        rawVariantId,
        item.item_name,
        item.hsn_sac || null,
        item.quantity,
        item.unit || 'PCS',
        item.unit_price,
        computed.discountPercent,
        computed.discountAmount,
        item.discount_account_id || null,
        computed.taxableValue,
        item.tax_rate || 0,
        lineTaxMode,
        computed.taxAmount,
        computed.cgstAmount,
        computed.sgstAmount,
        computed.igstAmount,
        computed.lineTotal,
        item.location_id || null,
        lineIntent,
      ]
    );

    let effectiveItemId =
      item.item_id && String(item.item_id).trim() !== '' ? String(item.item_id).trim() : null;
    if (!effectiveItemId && item.item_name) {
      effectiveItemId = await resolveCatalogItemIdForPurchase(client, business_id, {
        name: String(item.item_name),
        hsn_sac: (item.hsn_sac as string) ?? null,
      });
      if (effectiveItemId) {
        await client.query(
          'UPDATE purchase_items SET item_id = $1 WHERE purchase_id = $2 AND item_name = $3 AND item_id IS NULL',
          [effectiveItemId, purchase.id, item.item_name]
        );
      }
    }

    if (
      status === 'final' &&
      lineIntent === 'goods' &&
      !effectiveItemId &&
      String(item.item_name || '').trim().length > 0
    ) {
      try {
        const newId = await createCatalogItemFromAdHocPurchaseLine(client, {
          businessId: business_id,
          createdBy: created_by,
          rawLineName: String(item.item_name),
          unit: (item.unit as string) || 'PCS',
          purchasePrice: unitCostForStock,
          taxRate: Number(item.tax_rate) || 0,
          hsnSac: (item.hsn_sac as string) ?? null,
          defaultSupplierId: normalizedSupplierId,
        });
        effectiveItemId = newId;
        await client.query(
          'UPDATE purchase_items SET item_id = $1 WHERE purchase_id = $2 AND item_name = $3 AND item_id IS NULL',
          [effectiveItemId, purchase.id, item.item_name]
        );
      } catch (e) {
        if (e instanceof PurchaseStockError) {
          throw new PurchaseCreateServiceError(e.message, e.statusCode, e.code, e.details as Record<string, unknown>);
        }
        throw e;
      }
    }

    if (status === 'final' && lineIntent !== 'service' && !effectiveItemId) {
      throw new PurchaseCreateServiceError(
        `Goods line "${item.item_name || 'Item'}" is not linked to a catalogue item.`,
        400,
        'PURCHASE_GOODS_LINE_UNLINKED'
      );
    }

    if (status === 'final' && effectiveItemId) {
      const itemTypeRes = await client.query(
        'SELECT item_type, track_batch, track_serial FROM items WHERE id = $1 AND business_id = $2',
        [effectiveItemId, business_id]
      );
      const itemData = itemTypeRes.rows[0];
      if (!itemData) {
        throw new PurchaseStockError(
          `Item not in catalog`,
          400,
          'ITEM_BUSINESS_MISMATCH',
          { item_id: effectiveItemId }
        );
      }
      if ((itemData.item_type || 'goods') === 'goods') {
        await applyPurchaseGoodsStockLine(
          client,
          {
            businessId: business_id,
            branchId: finalBranchId,
            purchaseId: purchase.id,
            supplierId: normalizedSupplierId,
            billRef: body.bill_number || 'New',
            warehouseModeEnabled,
            trackBatch: itemData.track_batch || false,
            trackSerial: itemData.track_serial || false,
          },
          {
            item_id: effectiveItemId,
            variant_id: rawVariantId,
            item_name: item.item_name as string,
            quantity: Number(item.quantity) || 0,
            unit_price: unitCostForStock,
            location_id: (item.location_id as string) || null,
            batch_number: (item.batch_number as string) ?? null,
            serial_numbers: item.serial_numbers as string[] | undefined,
            manufacturing_date: (item.manufacturing_date as string) ?? null,
            expiry_date: (item.expiry_date as string) ?? null,
          }
        );
      }
    }
  }

  if (status === 'final') {
    let totalInventoryAmount = 0;
    const invRes = await client.query(
      `
      SELECT COALESCE(SUM(
        (COALESCE(i.purchase_price::numeric, pi.unit_price::numeric)) * pi.quantity::numeric
      ), 0) AS total
      FROM purchase_items pi
      JOIN items i ON i.id = pi.item_id AND i.business_id = $2
      WHERE pi.purchase_id = $1 AND i.item_type = 'goods'
      `,
      [purchase.id, business_id]
    );
    totalInventoryAmount = Number(invRes.rows[0]?.total) || 0;

    const { createPurchaseLedgerEntries } = await import('@/lib/ledger-utils');
    const isCashPurchase =
      !normalizedSupplierId || (paid_amount > 0 && paid_amount >= finalGrandTotal);
    await createPurchaseLedgerEntries({
      businessId: business_id,
      purchaseId: purchase.id,
      purchaseNumber: body.bill_number || String(purchase.id).substring(0, 8),
      purchaseDate: body.bill_date,
      grandTotal: finalGrandTotal,
      supplierId: normalizedSupplierId,
      isCashPurchase,
      inventoryAmount: totalInventoryAmount,
      branchId: finalBranchId,
      poolClient: client,
      taxableValue: finalSubtotal,
      cgstTotal: gstDoc.cgstTotal,
      sgstTotal: gstDoc.sgstTotal,
      igstTotal: gstDoc.igstTotal,
      itcEligible: body.itc_eligible !== false,
      isReverseCharge: !!body.is_reverse_charge,
    });

    if (normalizedSupplierId) {
      await client.query(
        `UPDATE suppliers SET current_balance = current_balance + $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
        [balanceAmount, normalizedSupplierId]
      );
    }

    if (paid_amount > 0) {
      await client.query(
        `
        INSERT INTO payments (
          business_id, branch_id, type, supplier_id, reference_type, reference_id,
          amount, payment_mode, payment_date, notes, created_by
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        `,
        [
          business_id,
          finalBranchId,
          'payable',
          normalizedSupplierId,
          'purchase',
          purchase.id,
          paid_amount,
          'cash',
          body.bill_date,
          `Payment for purchase ${body.bill_number || String(purchase.id).substring(0, 8)}`,
          created_by,
        ]
      );
    }

    await client.query(
      `UPDATE purchases SET status = 'final', is_editable = false, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [purchase.id]
    );
    purchase.status = 'final';
    purchase.is_editable = false;
  }

  return {
    purchase,
    grandTotal: finalGrandTotal,
    subtotal: finalSubtotal,
    taxTotal: finalTaxTotal,
    cgstTotal: gstDoc.cgstTotal,
    sgstTotal: gstDoc.sgstTotal,
    igstTotal: gstDoc.igstTotal,
  };
}

/** Server-side GST reconciliation for offline payloads. */
export function validatePurchaseGstPayload(body: CreatePurchaseInput): {
  ok: true;
  serverTotals: CreatePurchaseResult;
} | {
  ok: false;
  reason: string;
  serverTotals: { subtotal: number; taxTotal: number; grandTotal: number };
  clientTotals: { subtotal?: number; taxTotal?: number; grandTotal?: number };
} {
  const items = body.items ?? [];
  const gstDoc = computePurchaseDocument(
    items.map((item) => ({
      quantity: Number(item.quantity) || 0,
      unit_price: Number(item.unit_price) || 0,
      discount_percent: Number(item.discount_percent) || 0,
      discount_amount: Number(item.discount_amount) || 0,
      tax_rate: Number(item.tax_rate) || 0,
      tax_mode: item.tax_mode as string | undefined,
    })),
    {
      supplierStateCode: String(body.supplier_state_code || '').slice(0, 2),
      companyStateCode: String(body.place_of_supply_state_code || '').slice(0, 2),
      headerPriceMode: body.price_mode === 'inclusive' ? 'inclusive' : 'exclusive',
    }
  );

  const roundOff = typeof body.round_off === 'number' ? body.round_off : 0;
  const serverGrand = gstDoc.subtotal + gstDoc.taxTotal + roundOff;
  const tolerance = 0.05;

  const clientSub = body.subtotal;
  const clientTax = body.tax_total;
  const clientGrand = body.grand_total;

  const mismatch =
    (clientSub !== undefined && Math.abs(clientSub - gstDoc.subtotal) > tolerance) ||
    (clientTax !== undefined && Math.abs(clientTax - gstDoc.taxTotal) > tolerance) ||
    (clientGrand !== undefined && Math.abs(clientGrand - serverGrand) > tolerance);

  if (mismatch) {
    return {
      ok: false,
      reason: 'Client GST totals do not match server recomputation',
      serverTotals: {
        subtotal: gstDoc.subtotal,
        taxTotal: gstDoc.taxTotal,
        grandTotal: serverGrand,
      },
      clientTotals: {
        subtotal: clientSub,
        taxTotal: clientTax,
        grandTotal: clientGrand,
      },
    };
  }

  return {
    ok: true,
    serverTotals: {
      purchase: {},
      grandTotal: serverGrand,
      subtotal: gstDoc.subtotal,
      taxTotal: gstDoc.taxTotal,
      cgstTotal: gstDoc.cgstTotal,
      sgstTotal: gstDoc.sgstTotal,
      igstTotal: gstDoc.igstTotal,
    },
  };
}
