import { resolveGstScheme, resolveSupplierRegistration, stateCodeFromName } from '@/lib/gst/registration';
import { findWarehouseStateMismatch, warehouseStateMismatchMessage } from '@/lib/gst/warehouse-registration';
import { resolveSaleUnits, SaleUnitError } from '@/lib/items/item-units';
import { computeChallanLines, type ChallanLineInput } from '@/lib/delivery-challans/challan-math';
import {
  DELIVERY_CHALLAN_SERIES,
  issueSeriesNumber,
  peekSeriesNumber,
  resolveDocumentBranchId,
  type Queryable,
} from '@/lib/documents/series-number';

import { parseChallanKind, parseCustodyPurpose } from '@/lib/stock-custody/custody';

export * from '@/lib/delivery-challans/challan-math';

/** Number the next challan would get, without reserving it. */
export async function peekChallanNumber(db: Queryable, businessId: string, branchId?: string | null) {
  return peekSeriesNumber(db, DELIVERY_CHALLAN_SERIES, businessId, branchId);
}

export interface ChallanWriteInput {
  customer_id?: string | null;
  /** Holder of the goods on a returnable challan sent to a repairer or job worker. */
  supplier_id?: string | null;
  invoice_id?: string | null;
  sales_order_id?: string | null;
  branch_id?: string | null;
  challan_number?: string | null;
  /** True when the number in the form is the suggested one: the server issues the next free number. */
  auto_number?: boolean;
  challan_date?: string;
  delivery_date?: string | null;
  e_way_bill_number?: string | null;
  vehicle_number?: string | null;
  transporter_name?: string | null;
  transporter_gstin?: string | null;
  shipping_address?: string | null;
  billing_address?: string | null;
  place_of_delivery?: string | null;
  place_of_supply_state_code?: string | null;
  dispatch_from_address?: string | null;
  reason_for_transportation?: string | null;
  /** supply (paperwork only), returnable (goods go out and come back) or non_returnable. */
  challan_kind?: string | null;
  /** Why returnable goods went out: repair, job_work, approval, consignment, exhibition, demo, other. */
  purpose?: string | null;
  /** Godown the goods leave from (warehouse mode). */
  warehouse_id?: string | null;
  /** Stock transfer between godowns on one GSTIN: no party, no tax, the transfer moves the stock. */
  stock_transfer_id?: string | null;
  /** Godown the goods go to (stock transfers). */
  to_warehouse_id?: string | null;
  expected_return_date?: string | null;
  /** Job work only: inputs come back within 1 year, capital goods within 3 (s.143). */
  job_work_goods?: string | null;
  notes?: string | null;
  terms?: string | null;
  items?: ChallanLineInput[];
  created_by?: string | null;
  status?: string;
}

export class ChallanInputError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

/**
 * Create (no `existingId`) or replace a challan and its lines. Must run inside a transaction.
 * Values are recomputed here; the client's figures are only a preview.
 */
export async function writeChallan(
  client: Queryable,
  businessId: string,
  input: ChallanWriteInput,
  existingId?: string
): Promise<any> {
  if (!input.challan_date) throw new ChallanInputError('Challan date is required');
  const kind = parseChallanKind(input.challan_kind);
  const purpose = kind === 'returnable' ? parseCustodyPurpose(input.purpose) : null;
  if (kind === 'returnable' && !purpose) {
    throw new ChallanInputError('Choose why the goods are going out (repair, job work, approval...)');
  }
  if (kind === 'returnable' && !input.customer_id && !input.supplier_id) {
    throw new ChallanInputError('Select the supplier or customer who will hold the goods');
  }
  if (!input.customer_id && !input.supplier_id && !input.invoice_id && !input.sales_order_id && !input.stock_transfer_id) {
    throw new ChallanInputError('Select a customer, or link an invoice or sales order');
  }
  if (input.expected_return_date && input.challan_date && input.expected_return_date < input.challan_date) {
    throw new ChallanInputError('Expected return date cannot be before the challan date');
  }
  if (input.supplier_id) {
    const s = await client.query('SELECT 1 FROM suppliers WHERE id = $1 AND business_id = $2', [input.supplier_id, businessId]);
    if (!s.rows[0]) throw new ChallanInputError('Supplier not found', 404);
  }
  if (input.warehouse_id) {
    const w = await client.query('SELECT 1 FROM warehouses WHERE id = $1 AND business_id = $2', [input.warehouse_id, businessId]);
    if (!w.rows[0]) throw new ChallanInputError('Warehouse not found', 404);
  }

  const branchId = await resolveDocumentBranchId(client, businessId, input.branch_id);
  const [registration, scheme] = await Promise.all([
    resolveSupplierRegistration(client as any, businessId, branchId),
    resolveGstScheme(client as any, businessId, branchId),
  ]);
  const godownMismatch = await findWarehouseStateMismatch(client as any, businessId, registration, [input.warehouse_id]);
  if (godownMismatch) throw new ChallanInputError(warehouseStateMismatchMessage(godownMismatch));

  let posCode = input.place_of_supply_state_code ? String(input.place_of_supply_state_code).padStart(2, '0') : null;
  if (!posCode && input.customer_id) {
    const c = await client.query('SELECT state, state_code FROM customers WHERE id = $1 AND business_id = $2', [
      input.customer_id,
      businessId,
    ]);
    posCode = c.rows[0]?.state_code || stateCodeFromName(c.rows[0]?.state) || null;
  }
  posCode = posCode || registration.stateCode;
  const interState = !!(posCode && registration.stateCode && posCode !== registration.stateCode);

  const { lines, totals } = computeChallanLines(input.items || [], {
    interState,
    // Moving goods within one GSTIN is not a supply, so the challan carries value but no tax.
    chargeTax: scheme === 'regular' && !input.stock_transfer_id,
  });
  if (lines.length === 0) throw new ChallanInputError('Add at least one item with a quantity');

  let challanNumber = String(input.challan_number || '').trim();
  if (!existingId && (input.auto_number || !challanNumber)) {
    challanNumber = await issueSeriesNumber(client, DELIVERY_CHALLAN_SERIES, businessId, branchId);
  }
  if (!challanNumber) throw new ChallanInputError('Challan number is required');

  const values = [
    businessId,
    input.customer_id || null,
    input.invoice_id || null,
    input.sales_order_id || null,
    challanNumber,
    input.challan_date,
    input.delivery_date || null,
    input.e_way_bill_number || null,
    input.vehicle_number || null,
    input.transporter_name || null,
    input.transporter_gstin || null,
    input.shipping_address || null,
    input.billing_address || null,
    input.place_of_delivery || null,
    input.dispatch_from_address || null,
    input.reason_for_transportation || null,
    input.notes || null,
    input.terms || null,
    branchId,
    posCode,
    totals.subtotal,
    totals.cgst_total,
    totals.sgst_total,
    totals.igst_total,
    totals.tax_total,
    totals.grand_total,
    kind,
    purpose,
    input.supplier_id || null,
    input.warehouse_id || null,
    kind === 'returnable' ? input.expected_return_date || null : null,
    purpose === 'job_work' ? (input.job_work_goods === 'capital_goods' ? 'capital_goods' : 'inputs') : null,
  ];

  let challan: any;
  if (existingId) {
    const res = await client.query(
      `UPDATE delivery_challans SET
         customer_id = $2, invoice_id = $3, sales_order_id = $4, challan_number = $5, challan_date = $6,
         delivery_date = $7, e_way_bill_number = $8, vehicle_number = $9, transporter_name = $10,
         transporter_gstin = $11, shipping_address = $12, billing_address = $13, place_of_delivery = $14,
         dispatch_from_address = $15, reason_for_transportation = $16, notes = $17, terms = $18,
         branch_id = $19, place_of_supply_state_code = $20, subtotal = $21, cgst_total = $22,
         sgst_total = $23, igst_total = $24, tax_total = $25, grand_total = $26,
         challan_kind = $27, purpose = $28, supplier_id = $29, warehouse_id = $30, expected_return_date = $31,
         job_work_goods = $32
       WHERE id = $33 AND business_id = $1 AND stock_posted_at IS NULL
       RETURNING *`,
      [...values, existingId]
    );
    challan = res.rows[0];
    if (!challan) throw new ChallanInputError('Delivery challan not found, or its goods have already been sent out', 404);
    await client.query('DELETE FROM delivery_challan_items WHERE delivery_challan_id = $1', [existingId]);
  } else {
    // A returnable challan stays draft until its goods are sent out (that posts the stock).
    const status = input.status === 'sent' && kind !== 'returnable' ? 'sent' : 'draft';
    const res = await client.query(
      `INSERT INTO delivery_challans (
         business_id, customer_id, invoice_id, sales_order_id, challan_number, challan_date, delivery_date,
         e_way_bill_number, vehicle_number, transporter_name, transporter_gstin, shipping_address,
         billing_address, place_of_delivery, dispatch_from_address, reason_for_transportation, notes, terms,
         branch_id, place_of_supply_state_code, subtotal, cgst_total, sgst_total, igst_total, tax_total,
         grand_total, challan_kind, purpose, supplier_id, warehouse_id, expected_return_date, job_work_goods, created_by, status,
         stock_transfer_id, to_warehouse_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36)
       RETURNING *`,
      [...values, input.created_by || null, status, input.stock_transfer_id || null, input.to_warehouse_id || null]
    );
    challan = res.rows[0];
  }

  // A line in boxes keeps the box's factor; stock leaves as qty × factor when the goods go out.
  const saleUnits = await resolveSaleUnits(client as any, businessId, lines).catch((e) => {
    if (e instanceof SaleUnitError) throw new ChallanInputError(e.message);
    throw e;
  });
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    await client.query(
      `INSERT INTO delivery_challan_items (
         delivery_challan_id, item_id, item_name, description, hsn_sac, qty, unit, sort_order,
         unit_price, tax_rate, taxable_value, cgst_amount, sgst_amount, igst_amount, tax_amount, line_total, unit_factor
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
      [
        challan.id, l.item_id, l.item_name, l.description, l.hsn_sac, l.qty, saleUnits[i].unit ?? l.unit, i,
        l.unit_price, l.tax_rate, l.taxable_value, l.cgst_amount, l.sgst_amount, l.igst_amount, l.tax_amount, l.line_total,
        saleUnits[i].unit_factor,
      ]
    );
  }

  return challan;
}
