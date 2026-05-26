import type { PoolClient } from 'pg';
import { enforceAccess } from '@/lib/enforce-access';
import { FeatureKeys } from '@/lib/featureKeys';
import { adjustBranchItemStock, refreshItemGlobalStockFromBranches } from '@/lib/branch-stock';
import { adjustBranchVariantStock, refreshVariantGlobalStockFromBranches } from '@/lib/branch-variant-stock';
import { createInvoiceLedgerEntries, createPaymentLedgerEntries } from '@/lib/ledger-utils';
import {
  deductBundleChildrenOnInvoice,
  InvoiceBundleStockError,
  type BundleDeductionContext,
} from '@/lib/invoice-bundle-stock';
import {
  getClosingStockLockedCutoffDate,
  assertDocumentDateNotBeforeLockedClosingStock,
  ClosingStockPeriodLockedError,
} from '@/lib/closing-stock-period-lock';
import { deriveInvoicePaymentStatus } from '@/lib/invoice-payment-status';
import { resolveBranchId } from '@/lib/branch-helpers';
import {
  computeInvoiceTotals,
  getStateCode,
} from '@/lib/invoices/validate-invoice-gst-payload';

export class InvoiceCreateServiceError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public code?: string,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'InvoiceCreateServiceError';
  }
}

export interface CreateInvoiceItemInput {
  item_id?: string | null;
  variant_id?: string | null;
  item_name: string;
  quantity: number;
  unit?: string;
  unit_price: number;
  discount_percent?: number;
  tax_rate?: number;
  hsn_sac?: string | null;
  location_id?: string | null;
  description?: string | null;
}

export interface CreateInvoiceInput {
  business_id: string;
  created_by: string;
  branch_id?: string;
  customer_id?: string | null;
  invoice_date: string;
  due_date?: string | null;
  status?: 'draft' | 'final';
  items: CreateInvoiceItemInput[];
  subtotal?: number;
  tax_total?: number;
  additional_charges?: number;
  round_off?: number;
  grand_total?: number;
  notes?: string | null;
  billing_address?: string | null;
  shipping_address?: string | null;
  place_of_supply_state_code?: string | null;
  document_type?: string;
  is_export?: boolean;
  template_id?: string | null;
  payments?: Array<{
    amount: number;
    mode?: string;
    date?: string;
    reference?: string;
  }>;
  paid_amount?: number;
  balance_amount?: number;
  payment_status?: string;
  enable_round_off?: boolean;
  /** Client TMP reference — never used as legal invoice number on replay */
  offline_reference_number?: string | null;
  invoice_number?: string | null;
}

export interface CreateInvoiceOptions {
  /** Offline replay: always allocate legal number from branch counter */
  forceServerInvoiceNumber?: boolean;
  replayLogId?: string | null;
  deviceId?: string | null;
}

export interface CreateInvoiceResult {
  invoice: Record<string, unknown>;
  invoiceId: string;
  invoiceNumber: string;
  offlineReferenceNumber?: string | null;
  subtotal: number;
  taxTotal: number;
  grandTotal: number;
  cgstTotal: number;
  sgstTotal: number;
  igstTotal: number;
}

const DOCUMENT_TYPE_CONFIG: Record<string, { prefix: string }> = {
  tax_invoice: { prefix: 'INV' },
  regular: { prefix: 'INV' },
  proforma_invoice: { prefix: 'PI' },
  bill_of_supply: { prefix: 'BOS' },
};

async function allocateBranchInvoiceNumber(
  client: PoolClient,
  businessId: string,
  branchId: string,
  documentType: string
): Promise<string> {
  const config = DOCUMENT_TYPE_CONFIG[documentType] || DOCUMENT_TYPE_CONFIG.tax_invoice;
  const branchRes = await client.query(
    `SELECT invoice_prefix, next_invoice_number FROM branches WHERE id = $1 AND business_id = $2 FOR UPDATE`,
    [branchId, businessId]
  );
  if (branchRes.rows.length === 0) {
    throw new InvoiceCreateServiceError('Branch not found', 400, 'BRANCH_NOT_FOUND');
  }
  const branch = branchRes.rows[0] as {
    invoice_prefix?: string;
    next_invoice_number?: number;
  };

  let invoicePrefix = branch.invoice_prefix || config.prefix;
  try {
    const branchPrefixResult = await client.query(
      `SELECT prefix FROM branch_document_prefixes WHERE branch_id = $1 AND document_type = $2`,
      [branchId, documentType]
    );
    if (branchPrefixResult.rows.length > 0) {
      invoicePrefix = branchPrefixResult.rows[0].prefix;
    }
  } catch (error: unknown) {
    if ((error as { code?: string }).code !== '42P01') throw error;
  }

  const currentCounter = branch.next_invoice_number || 1;
  const invoiceNumber = `${invoicePrefix}-${String(currentCounter).padStart(3, '0')}`;

  const dup = await client.query(
    `SELECT id FROM invoices WHERE invoice_number = $1 AND branch_id = $2 AND business_id = $3 AND deleted_at IS NULL`,
    [invoiceNumber, branchId, businessId]
  );
  if (dup.rows.length > 0) {
    throw new InvoiceCreateServiceError(
      `Invoice number ${invoiceNumber} already exists for this branch`,
      409,
      'DUPLICATE_INVOICE_NUMBER'
    );
  }

  await client.query(
    `UPDATE branches SET next_invoice_number = next_invoice_number + 1, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND business_id = $2`,
    [branchId, businessId]
  );

  return invoiceNumber;
}

async function insertOfflineNumberMapping(
  client: PoolClient,
  input: {
    businessId: string;
    offlineReferenceNumber: string;
    finalInvoiceNumber: string;
    invoiceId: string;
    replayLogId?: string | null;
    deviceId?: string | null;
  }
): Promise<void> {
  await client.query(
    `
    INSERT INTO offline_invoice_number_map (
      business_id, offline_reference_number, final_invoice_number, invoice_id, replay_log_id, device_id
    )
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (business_id, offline_reference_number) DO NOTHING
    `,
    [
      input.businessId,
      input.offlineReferenceNumber,
      input.finalInvoiceNumber,
      input.invoiceId,
      input.replayLogId ?? null,
      input.deviceId ?? null,
    ]
  );
}

async function deductGoodsStockForLine(
  client: PoolClient,
  ctx: {
    businessId: string;
    branchId: string;
    invoiceId: string;
    customerId: string | null;
    item: CreateInvoiceItemInput;
  }
): Promise<void> {
  const { businessId, branchId, invoiceId, customerId, item } = ctx;
  if (!item.item_id) return;

  const itemTypeRes = await client.query(
    `SELECT item_type, COALESCE(is_bundle, false) AS is_bundle FROM items WHERE id = $1 AND business_id = $2`,
    [item.item_id, businessId]
  );
  const itemData = itemTypeRes.rows[0] as
    | { item_type?: string; is_bundle?: boolean }
    | undefined;
  if (!itemData || itemData.item_type === 'service') return;

  const quantity = Number(item.quantity) || 0;
  if (quantity <= 0) return;

  if (itemData.is_bundle) {
    if (item.variant_id) {
      throw new InvoiceCreateServiceError(
        'Bundle items cannot have a variant on the invoice line',
        400,
        'BUNDLE_VARIANT_NOT_ALLOWED'
      );
    }
    const { isWarehouseModeEnabled } = await import('@/lib/warehouse-mode');
    const warehouseModeEnabled = await isWarehouseModeEnabled(businessId);
    const bundleCtx: BundleDeductionContext = {
      client,
      businessId,
      branchId,
      invoiceId,
      customerId,
      warehouseModeEnabled,
      hasBatchTrackingColumns: false,
    };
    try {
      await deductBundleChildrenOnInvoice(
        bundleCtx,
        item.item_id,
        quantity,
        item.location_id || null,
        item.item_name || item.item_id
      );
    } catch (e) {
      if (e instanceof InvoiceBundleStockError) {
        const message =
          typeof e.body?.error === 'string'
            ? e.body.error
            : 'Insufficient bundle stock';
        throw new InvoiceCreateServiceError(
          message,
          e.statusCode,
          'STOCK_INSUFFICIENT',
          e.body as Record<string, unknown>
        );
      }
      throw e;
    }
    return;
  }

  const { isWarehouseModeEnabled } = await import('@/lib/warehouse-mode');
  const warehouseModeEnabled = await isWarehouseModeEnabled(businessId);
  if (warehouseModeEnabled && !item.location_id) {
    throw new InvoiceCreateServiceError(
      `Warehouse required for item "${item.item_name}"`,
      400,
      'WAREHOUSE_REQUIRED'
    );
  }

  if (item.variant_id) {
    if (warehouseModeEnabled && item.location_id) {
      await client.query(
        `UPDATE location_stock SET current_stock_qty = current_stock_qty - $1, last_updated = CURRENT_TIMESTAMP WHERE location_id = $2 AND item_id = $3`,
        [quantity, item.location_id, item.item_id]
      );
    } else {
      await adjustBranchVariantStock(client, businessId, branchId, item.variant_id, -quantity);
      await refreshVariantGlobalStockFromBranches(client, businessId, item.variant_id);
    }
  } else if (warehouseModeEnabled && item.location_id) {
    await client.query(
      `UPDATE location_stock SET current_stock_qty = current_stock_qty - $1, last_updated = CURRENT_TIMESTAMP WHERE location_id = $2 AND item_id = $3`,
      [quantity, item.location_id, item.item_id]
    );
  } else {
    await adjustBranchItemStock(client, businessId, branchId, item.item_id, -quantity);
    await refreshItemGlobalStockFromBranches(client, businessId, item.item_id);
  }

  await client.query(
    `INSERT INTO stock_movements (business_id, item_id, variant_id, location_id, type, quantity, reference_type, reference_id)
     VALUES ($1, $2, $3, $4, 'out', $5, 'invoice', $6)`,
    [
      businessId,
      item.item_id,
      item.variant_id || null,
      item.location_id || null,
      quantity,
      invoiceId,
    ]
  );
}

/**
 * Creates a final sales invoice inside an existing transaction (no BEGIN/COMMIT).
 * Used by offline replay — mirrors POST /api/invoices for status=final new invoices.
 */
export async function createInvoiceInTransaction(
  client: PoolClient,
  body: CreateInvoiceInput,
  options: CreateInvoiceOptions = {}
): Promise<CreateInvoiceResult> {
  const business_id = body.business_id;
  const created_by = body.created_by;
  const status = body.status ?? 'final';
  const items = body.items ?? [];
  const document_type = body.document_type ?? 'tax_invoice';

  if (!business_id || !body.invoice_date || items.length === 0) {
    throw new InvoiceCreateServiceError(
      'business_id, invoice_date, and items are required',
      400,
      'VALIDATION_ERROR'
    );
  }
  if (!created_by) {
    throw new InvoiceCreateServiceError('created_by is required', 400, 'VALIDATION_ERROR');
  }
  if (status !== 'final') {
    throw new InvoiceCreateServiceError(
      'Offline replay only supports status final',
      400,
      'VALIDATION_ERROR'
    );
  }
  if (document_type === 'proforma_invoice') {
    throw new InvoiceCreateServiceError(
      'Proforma invoices cannot be finalized via offline replay',
      400,
      'VALIDATION_ERROR'
    );
  }

  try {
    const cutoff = await getClosingStockLockedCutoffDate(business_id);
    assertDocumentDateNotBeforeLockedClosingStock(
      String(body.invoice_date).slice(0, 10),
      cutoff
    );
  } catch (e) {
    if (e instanceof ClosingStockPeriodLockedError) {
      throw new InvoiceCreateServiceError(e.message, 409, 'CLOSING_STOCK_PERIOD_LOCKED', {
        cutoff: e.cutoffDate,
      });
    }
    throw e;
  }

  const finalBranchId = await resolveBranchId({
    branchId: body.branch_id,
    businessId: business_id,
  });

  await enforceAccess({
    businessId: business_id,
    userId: created_by,
    branchId: finalBranchId,
    feature: FeatureKeys.INVOICE_CREATION,
    limitType: 'invoices',
    poolClient: client,
  });

  if (body.customer_id) {
    const cust = await client.query(
      `SELECT id FROM customers WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL`,
      [body.customer_id, business_id]
    );
    if (cust.rows.length === 0) {
      throw new InvoiceCreateServiceError('Customer not found', 400, 'CUSTOMER_NOT_FOUND');
    }
  }

  for (const item of items) {
    if (item.item_id) {
      const exists = await client.query(
        `SELECT id FROM items WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL`,
        [item.item_id, business_id]
      );
      if (exists.rows.length === 0) {
        throw new InvoiceCreateServiceError(
          `Product "${item.item_name}" no longer exists`,
          409,
          'PRODUCT_DELETED',
          { item_id: item.item_id }
        );
      }
    }
  }

  const businessRes = await client.query(
    `SELECT state_code, state FROM businesses WHERE id = $1`,
    [business_id]
  );
  if (businessRes.rows.length === 0) {
    throw new InvoiceCreateServiceError('Business not found', 400, 'BUSINESS_NOT_FOUND');
  }
  const business = businessRes.rows[0] as { state_code?: string; state?: string };
  const businessStateCode =
    business.state_code || getStateCode(business.state || '');

  const totals = computeInvoiceTotals(body, businessStateCode);
  const paymentEntries = body.payments ?? [];
  let paidAmount = body.paid_amount ?? 0;
  if (paymentEntries.length > 0) {
    paidAmount = paymentEntries.reduce((s, p) => s + (Number(p.amount) || 0), 0);
  }
  const balanceAmount = totals.grandTotal - paidAmount;
  const paymentStatus = deriveInvoicePaymentStatus(
    totals.grandTotal,
    paidAmount,
    balanceAmount
  );

  const invoiceNumber = await allocateBranchInvoiceNumber(
    client,
    business_id,
    finalBranchId,
    document_type
  );

  const invoiceRes = await client.query(
    `
    INSERT INTO invoices (
      business_id, branch_id, customer_id, invoice_number, invoice_date, due_date,
      status, payment_status, subtotal, discount_total, additional_charges, tax_total,
      round_off, grand_total, paid_amount, balance_amount, notes,
      billing_address, shipping_address, place_of_supply_state_code,
      cgst_total, sgst_total, igst_total, is_editable,
      document_type, is_export, created_by, template_id, enable_round_off
    )
    VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29
    )
    RETURNING *
    `,
    [
      business_id,
      finalBranchId,
      body.customer_id || null,
      invoiceNumber,
      body.invoice_date,
      body.due_date || null,
      status,
      paymentStatus,
      totals.subtotal,
      totals.discountTotal,
      Number(body.additional_charges) || 0,
      totals.taxTotal,
      totals.roundOff,
      totals.grandTotal,
      paidAmount,
      balanceAmount,
      body.notes || null,
      body.billing_address || null,
      body.shipping_address || null,
      body.place_of_supply_state_code || businessStateCode || null,
      totals.cgstTotal,
      totals.sgstTotal,
      totals.igstTotal,
      false,
      document_type,
      body.is_export ?? false,
      created_by,
      body.template_id || null,
      body.enable_round_off ?? false,
    ]
  );

  const invoice = invoiceRes.rows[0] as Record<string, unknown>;
  const invoiceId = String(invoice.id);

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const qty = Number(item.quantity) || 0;
    const unitPrice = Number(item.unit_price) || 0;
    const itemSubtotal = qty * unitPrice;
    const itemDiscount = (itemSubtotal * (Number(item.discount_percent) || 0)) / 100;
    const taxable = itemSubtotal - itemDiscount;
    const taxRate = Number(item.tax_rate) || 0;
    const placeOfSupply = body.place_of_supply_state_code || businessStateCode;
    let cgst = 0;
    let sgst = 0;
    let igst = 0;
    let taxAmount = 0;
    if (placeOfSupply && businessStateCode && placeOfSupply === businessStateCode) {
      const half = taxRate / 2;
      cgst = (taxable * half) / 100;
      sgst = (taxable * half) / 100;
      taxAmount = cgst + sgst;
    } else {
      igst = (taxable * taxRate) / 100;
      taxAmount = igst;
    }
    const lineTotal = taxable + taxAmount;

    await client.query(
      `
      INSERT INTO invoice_items (
        invoice_id, item_id, variant_id, item_name, description, hsn_sac,
        quantity, unit, unit_price, discount_percent, discount_amount,
        tax_rate, tax_amount, taxable_value, cgst_amount, sgst_amount, igst_amount,
        line_total, sort_order
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
      `,
      [
        invoiceId,
        item.item_id || null,
        item.variant_id || null,
        item.item_name,
        item.description || null,
        item.hsn_sac || null,
        qty,
        item.unit || 'PCS',
        unitPrice,
        item.discount_percent || 0,
        itemDiscount,
        taxRate,
        taxAmount,
        taxable,
        cgst,
        sgst,
        igst,
        lineTotal,
        i,
      ]
    );

    await deductGoodsStockForLine(client, {
      businessId: business_id,
      branchId: finalBranchId,
      invoiceId,
      customerId: body.customer_id || null,
      item,
    });
  }

  const insertedPayments: Array<{
    id: string;
    amount: number;
    mode: string;
    date: string | Date;
    reference?: string;
  }> = [];

  if (paymentEntries.length > 0) {
    for (const p of paymentEntries) {
      const pAmount = Number(p.amount) || 0;
      if (pAmount <= 0) continue;
      const ins = await client.query<{ id: string }>(
        `
        INSERT INTO payments (
          business_id, branch_id, type, customer_id, reference_type, reference_id,
          amount, payment_mode, payment_date, notes
        )
        VALUES ($1, $2, 'receivable', $3, 'invoice', $4, $5, $6, $7, $8)
        RETURNING id
        `,
        [
          business_id,
          finalBranchId,
          body.customer_id || null,
          invoiceId,
          pAmount,
          p.mode || 'cash',
          p.date || body.invoice_date,
          p.reference
            ? `Payment for Invoice ${invoiceNumber} - Ref: ${p.reference}`
            : `Payment for Invoice ${invoiceNumber}`,
        ]
      );
      insertedPayments.push({
        id: ins.rows[0].id,
        amount: pAmount,
        mode: p.mode || 'cash',
        date: p.date || body.invoice_date,
        reference: p.reference,
      });
    }
  }

  if (body.customer_id) {
    await client.query(
      `UPDATE customers SET current_balance = current_balance + $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
      [balanceAmount, body.customer_id]
    );
  }

  const isCashSale = !body.customer_id;
  const paymentMode = insertedPayments[0]?.mode || paymentEntries[0]?.mode || 'cash';

  await createInvoiceLedgerEntries({
    businessId: business_id,
    invoiceId,
    invoiceNumber,
    invoiceDate: body.invoice_date,
    grandTotal: totals.grandTotal,
    customerId: body.customer_id || null,
    paymentMode,
    isCashSale,
    cogsAmount: 0,
    branchId: finalBranchId,
    taxableValue: totals.subtotal,
    cgstTotal: totals.cgstTotal,
    sgstTotal: totals.sgstTotal,
    igstTotal: totals.igstTotal,
    poolClient: client,
  });

  if (body.customer_id && insertedPayments.length > 0) {
    for (const p of insertedPayments) {
      await createPaymentLedgerEntries({
        businessId: business_id,
        paymentId: p.id,
        paymentDate: p.date,
        amount: p.amount,
        type: 'receivable',
        customerId: body.customer_id,
        paymentMode: p.mode,
        referenceNumber: invoiceNumber,
        description: `Receipt against Invoice ${invoiceNumber}${p.reference ? ` (Ref: ${p.reference})` : ''}`,
        branchId: finalBranchId,
        poolClient: client,
      });
    }
  }

  const offlineRef = body.offline_reference_number?.trim() || null;
  if (offlineRef) {
    await insertOfflineNumberMapping(client, {
      businessId: business_id,
      offlineReferenceNumber: offlineRef,
      finalInvoiceNumber: invoiceNumber,
      invoiceId,
      replayLogId: options.replayLogId,
      deviceId: options.deviceId,
    });
  }

  return {
    invoice,
    invoiceId,
    invoiceNumber,
    offlineReferenceNumber: offlineRef,
    subtotal: totals.subtotal,
    taxTotal: totals.taxTotal,
    grandTotal: totals.grandTotal,
    cgstTotal: totals.cgstTotal,
    sgstTotal: totals.sgstTotal,
    igstTotal: totals.igstTotal,
  };
}

export { validateInvoiceGstPayload } from '@/lib/invoices/validate-invoice-gst-payload';
