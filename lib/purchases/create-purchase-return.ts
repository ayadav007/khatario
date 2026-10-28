import type { PoolClient } from 'pg';
import { createPurchaseReturnLedgerEntries } from '@/lib/ledger-utils';
import { nextCostShare } from '@/lib/purchases/acquisition-cost';
import { landedCostLeavingWithReturn } from '@/lib/inventory/landed-cost-application';
import { resolveBranchId } from '@/lib/branch-helpers';
import {
  alreadyReturnedByBillLine,
  applyIncidentalFreightRefund,
  buildReturnLinesFromBill,
  buildStandaloneReturnLines,
  incidentalAllocationsFromCharges,
  purchaseReturnLineKey,
  PurchaseReturnValidationError,
  resolveBillLineKey,
  type ReturnRequestLine,
} from '@/lib/purchases/purchase-return-lines';
import { movePurchaseReturnStock } from '@/lib/purchases/purchase-return-stock';
import { authorize } from '@/lib/authorization';
import { markGstReadinessStale } from '@/lib/gst/period-freshness';

export type PurchaseReturnInput = {
  businessId: string;
  userId: string;
  purchaseId?: string | null;
  supplierId?: string | null;
  returnNumber: string;
  returnDate: string;
  originalPurchaseDate?: string | null;
  reason?: string | null;
  items: ReturnRequestLine[];
  notes?: string | null;
  refundStatus?: string;
  refundMode?: string | null;
  refundDate?: string | null;
  roundOff?: number;
  refundIncidentalCharges?: boolean;
  placeOfSupplyStateCode?: string | null;
};

export type PurchaseReturnResult =
  | { ok: true; purchaseReturn: any }
  | { ok: false; status: number; error: string; code?: string; details?: Record<string, unknown> };

/**
 * Records a purchase return (debit note) inside the caller's transaction: quantities capped at
 * the bill's purchased minus already returned, value and GST from the bill lines, stock out,
 * supplier and bill balance down, ledger and GST readiness. POST /api/purchase-returns and the
 * Supplier Hub receipt (auto-return of short and damaged goods) both go through here.
 * The caller owns BEGIN/COMMIT and rolls back on `ok: false` or a throw.
 */
export async function createPurchaseReturnInTx(
  client: PoolClient,
  input: PurchaseReturnInput
): Promise<PurchaseReturnResult> {
  const business_id = input.businessId;
  const purchase_id = input.purchaseId || null;
  const return_number = input.returnNumber;
  const return_date = input.returnDate;
  const fail = (status: number, error: string, code?: string, details?: Record<string, unknown>) =>
    ({ ok: false, status, error, code, details }) as const;

  let bill: any = null;
  if (purchase_id) {
    const pb = await client.query(
      `SELECT id, branch_id, supplier_id, status, bill_date, place_of_supply_state_code, supplier_state_code,
              COALESCE(itc_eligible, true) AS itc_eligible, COALESCE(is_reverse_charge, false) AS is_reverse_charge
         FROM purchases
        WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL
        FOR UPDATE`,
      [purchase_id, business_id]
    );
    bill = pb.rows[0] ?? null;
    if (!bill) return fail(404, 'Original purchase bill not found', 'PURCHASE_NOT_FOUND');
    if (bill.status !== 'final') {
      return fail(400, 'Returns can only be recorded against a final purchase bill', 'PURCHASE_NOT_FINAL');
    }
  }
  const supplier_id: string | null = input.supplierId || bill?.supplier_id || null;
  if (bill && input.supplierId && bill.supplier_id && input.supplierId !== bill.supplier_id) {
    return fail(400, 'Supplier does not match the original bill', 'SUPPLIER_MISMATCH');
  }

  let stockBranchId: string;
  try {
    stockBranchId = await resolveBranchId({ businessId: business_id, branchId: bill?.branch_id ?? null });
  } catch (e: any) {
    return fail(400, e?.message || 'Could not resolve branch for purchase return');
  }

  // An AuthorizationError is thrown to the caller, which answers with its own response.
  await authorize(input.userId, 'purchases', 'create', { branchId: stockBranchId, businessId: business_id });

  const { isWarehouseModeEnabled } = await import('@/lib/warehouse-mode');
  let defaultWarehouseId: string | null = null;
  if (await isWarehouseModeEnabled(business_id)) {
    const { getDefaultWarehouseForBranch } = await import('@/lib/warehouse-access');
    defaultWarehouseId = await getDefaultWarehouseForBranch(stockBranchId);
    if (!defaultWarehouseId) {
      return fail(
        400,
        'Warehouse mode is enabled but no default warehouse is configured for this branch. Configure a default warehouse before recording purchase returns that affect stock.',
        'WAREHOUSE_REQUIRED'
      );
    }
  }

  const { assertGstPeriodNotFiledForDocumentDate } = await import('@/lib/gst/gst-filing');
  try {
    await assertGstPeriodNotFiledForDocumentDate(business_id, stockBranchId, return_date, 'save purchase return');
  } catch (error: any) {
    return fail(403, error.message || 'GST period is filed', 'GST_PERIOD_FILED');
  }
  const { assertPeriodNotLocked } = await import('@/lib/period-lock-utils');
  try {
    await assertPeriodNotLocked(business_id, stockBranchId, return_date, 'purchase return');
  } catch (error: any) {
    return fail(403, error.message || 'Period is locked', 'PERIOD_LOCKED');
  }

  const businessRes = await client.query('SELECT state_code FROM businesses WHERE id = $1', [business_id]);
  const { resolveSupplierRegistration } = await import('@/lib/gst/registration');
  const businessStateCode = String(
    (await resolveSupplierRegistration(client, business_id, stockBranchId)).stateCode ||
      businessRes.rows[0]?.state_code ||
      ''
  ).slice(0, 2);
  let supplierStateCode = String(bill?.supplier_state_code || '').slice(0, 2);
  if (!supplierStateCode && supplier_id) {
    const s = await client.query('SELECT state_code, gstin FROM suppliers WHERE id = $1 AND business_id = $2', [
      supplier_id,
      business_id,
    ]);
    supplierStateCode = String(s.rows[0]?.state_code || s.rows[0]?.gstin || '').slice(0, 2);
  }
  const posStateCode =
    bill?.place_of_supply_state_code || input.placeOfSupplyStateCode || supplierStateCode || null;

  let computed: ReturnType<typeof buildReturnLinesFromBill>;
  try {
    if (bill) {
      const billLines = await client.query(
        `SELECT item_id, item_name, hsn_sac, unit, quantity::float8 AS quantity,
                taxable_value::float8 AS taxable_value, tax_rate::float8 AS tax_rate,
                COALESCE(igst_amount, 0)::float8 AS igst_amount, variant_id
           FROM purchase_items WHERE purchase_id = $1`,
        [bill.id]
      );
      const returned = await client.query(
        `SELECT pri.item_id, pri.description, pri.variant_id, SUM(pri.qty)::float8 AS qty
           FROM purchase_return_items pri
           JOIN purchase_returns pr ON pr.id = pri.return_id
          WHERE pr.purchase_id = $1 AND pr.business_id = $2
            AND COALESCE(pr.status, 'final') <> 'cancelled'
          GROUP BY pri.item_id, pri.description, pri.variant_id`,
        [bill.id, business_id]
      );
      computed = buildReturnLinesFromBill({
        billLines: billLines.rows,
        requested: input.items,
        alreadyReturned: alreadyReturnedByBillLine(billLines.rows, returned.rows),
        roundOff: input.roundOff || 0,
      });
    } else {
      computed = buildStandaloneReturnLines({
        requested: input.items,
        interState: !!supplierStateCode && !!businessStateCode && supplierStateCode !== businessStateCode,
        roundOff: input.roundOff || 0,
      });
    }
  } catch (e) {
    if (e instanceof PurchaseReturnValidationError) return fail(400, e.message, e.code, e.details);
    throw e;
  }
  const { lines, totals } = computed;
  let inventoryRelief: number | undefined;
  let landedCostRelief = 0;
  if (bill) {
    const sourceLines = await client.query<{
      item_id: string;
      variant_id: string | null;
      quantity: string;
      taxable_value: string;
      acquisition_cost: string | null;
      line_item_type: string | null;
      itc_type: string | null;
    }>(
      `SELECT item_id, variant_id, quantity, taxable_value, acquisition_cost, line_item_type, itc_type
         FROM purchase_items WHERE purchase_id = $1 FOR UPDATE`,
      [bill.id]
    );
    const priorQty = await client.query<{ item_id: string; variant_id: string | null; description: string | null; qty: string }>(
      `SELECT pri.item_id, pri.variant_id, pri.description, pri.qty
         FROM purchase_return_items pri
         JOIN purchase_returns pr ON pr.id = pri.return_id
        WHERE pr.purchase_id = $1 AND pr.business_id = $2
          AND COALESCE(pr.status, 'final') <> 'cancelled'
        ORDER BY pr.created_at, pri.sort_order`,
      [bill.id, business_id]
    );
    // Earlier return slices: per item for freight, per bill line (item and variant) for cost.
    const sourceKeys = new Set(
      sourceLines.rows.map((row) => purchaseReturnLineKey(row.item_id, null, row.variant_id))
    );
    const priors = new Map<string, number[]>();
    const priorsByLine = new Map<string, number[]>();
    for (const row of priorQty.rows) {
      if (!row.item_id) continue;
      const list = priors.get(row.item_id) || [];
      list.push(Number(row.qty) || 0);
      priors.set(row.item_id, list);
      const { key } = resolveBillLineKey(sourceKeys, row.item_id, row.description, row.variant_id);
      const byLine = priorsByLine.get(key) || [];
      byLine.push(Number(row.qty) || 0);
      priorsByLine.set(key, byLine);
    }
    inventoryRelief = 0;
    for (const line of lines) {
      if (!line.item_id) continue;
      // The bill line this return line was matched to, so each size is valued at its own cost.
      const source = sourceLines.rows.find(
        (row) =>
          row.item_id === line.item_id &&
          (row.variant_id ?? null) === (line.variant_id ?? null) &&
          row.itc_type !== 'capital_goods' &&
          row.line_item_type !== 'service'
      );
      if (!source) continue;
      const acquisition =
        source.acquisition_cost != null ? Number(source.acquisition_cost) : Number(source.taxable_value);
      inventoryRelief += nextCostShare(
        acquisition,
        Number(source.quantity) || 0,
        priorsByLine.get(purchaseReturnLineKey(line.item_id, null, line.variant_id)) || [],
        line.qty
      );
    }
    const returnQtyByItem = new Map<string, number>();
    for (const line of lines) {
      if (!line.item_id) continue;
      returnQtyByItem.set(line.item_id, (returnQtyByItem.get(line.item_id) || 0) + line.qty);
    }
    for (const [itemId, returnQty] of returnQtyByItem) {
      const source = sourceLines.rows.find(
        (row) => row.item_id === itemId && row.itc_type !== 'capital_goods' && row.line_item_type !== 'service'
      );
      if (!source) continue;
      const acquisition =
        source.acquisition_cost != null ? Number(source.acquisition_cost) : Number(source.taxable_value);
      const leaving = await landedCostLeavingWithReturn(client, {
        businessId: business_id,
        purchaseId: bill.id,
        itemId,
        quantity: Number(source.quantity) || 0,
        acquisitionCost: acquisition,
        returnQty,
      });
      inventoryRelief += leaving.total;
      landedCostRelief += leaving.linked;
    }
    inventoryRelief = Math.round(inventoryRelief * 100) / 100;
    landedCostRelief = Math.round(landedCostRelief * 100) / 100;

    if (input.refundIncidentalCharges === true) {
      const charges = await client.query<{
        id: string;
        taxable_value: string;
        cgst_amount: string;
        sgst_amount: string;
        igst_amount: string;
        item_id: string;
        amount: string;
        quantity: string;
      }>(
        `SELECT pc.id, pc.taxable_value, pc.cgst_amount, pc.sgst_amount, pc.igst_amount,
                pi.item_id, a.amount, pi.quantity
           FROM purchase_charges pc
           JOIN purchase_charge_allocations a ON a.purchase_charge_id = pc.id
           JOIN purchase_items pi ON pi.id = a.purchase_item_id
          WHERE pc.purchase_id = $1 AND pc.classification = 'incidental_to_goods'`,
        [bill.id]
      );
      const grouped = new Map<string, {
        classification: 'incidental_to_goods';
        taxable_value: string;
        cgst_amount: string;
        sgst_amount: string;
        igst_amount: string;
        allocations: Array<{ item_id: string; amount: string; quantity: string }>;
      }>();
      for (const row of charges.rows) {
        const charge = grouped.get(row.id) || {
          classification: 'incidental_to_goods' as const,
          taxable_value: row.taxable_value,
          cgst_amount: row.cgst_amount,
          sgst_amount: row.sgst_amount,
          igst_amount: row.igst_amount,
          allocations: [],
        };
        charge.allocations.push({ item_id: row.item_id, amount: row.amount, quantity: row.quantity });
        grouped.set(row.id, charge);
      }
      const refunded = applyIncidentalFreightRefund(totals, {
        allocations: incidentalAllocationsFromCharges([...grouped.values()]),
        lines,
        priorQuantities: priors,
      });
      totals.subtotal = refunded.subtotal;
      totals.cgst_total = refunded.cgst_total;
      totals.sgst_total = refunded.sgst_total;
      totals.igst_total = refunded.igst_total;
      totals.tax_total = refunded.tax_total;
      totals.grand_total = refunded.grand_total;
    }
  }

  const returnResult = await client.query(
    `INSERT INTO purchase_returns (
       business_id, branch_id, supplier_id, purchase_id, return_number, return_date,
       original_purchase_date, reason, place_of_supply_state_code,
       subtotal, discount_total, tax_total, cgst_total, sgst_total, igst_total,
       round_off, grand_total, refund_status, refund_mode, refund_date,
       itc_reversed, itc_reversal_date, notes, created_by, status
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,0,$11,$12,$13,$14,$15,$16,$17,$18,$19,true,$6,$20,$21,'final')
     RETURNING *`,
    [
      business_id,
      stockBranchId,
      supplier_id,
      purchase_id,
      return_number,
      return_date,
      input.originalPurchaseDate || bill?.bill_date || null,
      input.reason || null,
      posStateCode,
      totals.subtotal,
      totals.tax_total,
      totals.cgst_total,
      totals.sgst_total,
      totals.igst_total,
      Math.round((totals.grand_total - totals.subtotal - totals.tax_total) * 100) / 100,
      totals.grand_total,
      input.refundStatus || 'pending',
      input.refundMode || null,
      input.refundDate || null,
      input.notes || null,
      input.userId,
    ]
  );
  const purchaseReturn = returnResult.rows[0];

  let inventoryAmount = inventoryRelief ?? 0;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    await client.query(
      `INSERT INTO purchase_return_items (
         return_id, item_id, description, hsn_sac, qty, unit, unit_price,
         discount_percent, discount_amount, taxable_value,
         tax_rate, tax_amount, cgst_amount, sgst_amount, igst_amount, line_total, sort_order, variant_id
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,0,0,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [
        purchaseReturn.id,
        l.item_id,
        l.description,
        l.hsn_sac,
        l.qty,
        l.unit,
        l.unit_price,
        l.taxable_value,
        l.tax_rate,
        l.tax_amount,
        l.cgst_amount,
        l.sgst_amount,
        l.igst_amount,
        l.line_total,
        i,
        l.variant_id ?? null,
      ]
    );
    if (l.item_id) {
      const t = await client.query(`SELECT item_type FROM items WHERE id = $1 AND business_id = $2`, [
        l.item_id,
        business_id,
      ]);
      if (inventoryRelief == null && (t.rows[0]?.item_type || 'goods') === 'goods') inventoryAmount += l.taxable_value;
      await movePurchaseReturnStock(client, {
        businessId: business_id,
        branchId: stockBranchId,
        warehouseId: defaultWarehouseId,
        itemId: l.item_id,
        variantId: l.variant_id ?? null,
        qty: l.qty,
        direction: 'out',
        returnId: purchaseReturn.id,
        referenceType: 'purchase_return',
        notes: `Return to Supplier: ${return_number}`,
      });
    }
  }
  inventoryAmount = Math.round(inventoryAmount * 100) / 100;

  if (supplier_id) {
    await client.query(
      `UPDATE suppliers SET current_balance = current_balance - $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
      [totals.grand_total, supplier_id]
    );
  }
  if (purchase_id) {
    await client.query(
      `UPDATE purchases SET balance_amount = balance_amount - $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
      [totals.grand_total, purchase_id]
    );
  }

  await createPurchaseReturnLedgerEntries({
    businessId: business_id,
    purchaseReturnId: purchaseReturn.id,
    returnNumber: return_number,
    returnDate: return_date,
    grandTotal: totals.grand_total,
    supplierId: supplier_id,
    inventoryAmount,
    inventoryRelief,
    landedCostRelief,
    branchId: stockBranchId,
    taxableValue: totals.subtotal,
    cgstTotal: totals.cgst_total,
    sgstTotal: totals.sgst_total,
    igstTotal: totals.igst_total,
    itcEligible: bill ? bill.itc_eligible !== false : true,
    isReverseCharge: bill ? bill.is_reverse_charge === true : false,
    poolClient: client,
  });

  await markGstReadinessStale(client, business_id, {
    dates: [return_date ? String(return_date).slice(0, 10) : null],
    monthly: ['gstr2b', 'gstr3b'],
  });
  return { ok: true, purchaseReturn };
}
