import { resolveGstScheme, resolveSupplierRegistration, stateCodeFromName } from '@/lib/gst/registration';
import { computeChallanLines, type ChallanLineInput } from '@/lib/delivery-challans/challan-math';
import {
  DELIVERY_CHALLAN_SERIES,
  issueSeriesNumber,
  peekSeriesNumber,
  resolveDocumentBranchId,
  type Queryable,
} from '@/lib/documents/series-number';

export * from '@/lib/delivery-challans/challan-math';

/** Number the next challan would get, without reserving it. */
export async function peekChallanNumber(db: Queryable, businessId: string, branchId?: string | null) {
  return peekSeriesNumber(db, DELIVERY_CHALLAN_SERIES, businessId, branchId);
}

export interface ChallanWriteInput {
  customer_id?: string | null;
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
  if (!input.customer_id && !input.invoice_id && !input.sales_order_id) {
    throw new ChallanInputError('Select a customer, or link an invoice or sales order');
  }

  const branchId = await resolveDocumentBranchId(client, businessId, input.branch_id);
  const [registration, scheme] = await Promise.all([
    resolveSupplierRegistration(client as any, businessId, branchId),
    resolveGstScheme(client as any, businessId, branchId),
  ]);

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
    chargeTax: scheme === 'regular',
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
         sgst_total = $23, igst_total = $24, tax_total = $25, grand_total = $26
       WHERE id = $27 AND business_id = $1
       RETURNING *`,
      [...values, existingId]
    );
    challan = res.rows[0];
    if (!challan) throw new ChallanInputError('Delivery challan not found', 404);
    await client.query('DELETE FROM delivery_challan_items WHERE delivery_challan_id = $1', [existingId]);
  } else {
    const status = input.status === 'sent' ? 'sent' : 'draft';
    const res = await client.query(
      `INSERT INTO delivery_challans (
         business_id, customer_id, invoice_id, sales_order_id, challan_number, challan_date, delivery_date,
         e_way_bill_number, vehicle_number, transporter_name, transporter_gstin, shipping_address,
         billing_address, place_of_delivery, dispatch_from_address, reason_for_transportation, notes, terms,
         branch_id, place_of_supply_state_code, subtotal, cgst_total, sgst_total, igst_total, tax_total,
         grand_total, created_by, status
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28)
       RETURNING *`,
      [...values, input.created_by || null, status]
    );
    challan = res.rows[0];
  }

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    await client.query(
      `INSERT INTO delivery_challan_items (
         delivery_challan_id, item_id, item_name, description, hsn_sac, qty, unit, sort_order,
         unit_price, tax_rate, taxable_value, cgst_amount, sgst_amount, igst_amount, tax_amount, line_total
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [
        challan.id, l.item_id, l.item_name, l.description, l.hsn_sac, l.qty, l.unit, i,
        l.unit_price, l.tax_rate, l.taxable_value, l.cgst_amount, l.sgst_amount, l.igst_amount, l.tax_amount, l.line_total,
      ]
    );
  }

  return challan;
}
