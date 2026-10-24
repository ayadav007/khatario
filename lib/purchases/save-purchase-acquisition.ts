import type { PoolClient } from 'pg';
import { getInventoryModel } from '@/lib/inventory/cogs-posting';
import { planAcquisitionCosts, type AcquisitionPlan } from '@/lib/purchases/acquisition-cost';

/** Stores charges and, on a final perpetual bill, the line acquisition cost. Does not post the ledger. */
export async function savePurchaseAcquisition(
  client: PoolClient,
  args: {
    purchaseId: string;
    businessId: string;
    lineIds: string[];
    plan: AcquisitionPlan;
    applyCosts: boolean;
  }
): Promise<void> {
  await client.query(`DELETE FROM purchase_charges WHERE purchase_id = $1 AND business_id = $2`, [
    args.purchaseId,
    args.businessId,
  ]);
  const chargeIds: string[] = [];
  for (let i = 0; i < args.plan.charges.length; i++) {
    const charge = args.plan.charges[i];
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO purchase_charges (
         purchase_id, business_id, purpose, classification, hsn_sac, tax_rate,
         taxable_value, cgst_amount, sgst_amount, igst_amount, tax_amount, sort_order
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING id`,
      [
        args.purchaseId,
        args.businessId,
        charge.purpose,
        charge.classification,
        charge.hsnSac,
        charge.taxRate,
        charge.taxable,
        charge.cgst,
        charge.sgst,
        charge.igst,
        charge.tax,
        i,
      ]
    );
    chargeIds.push(inserted.rows[0].id);
  }
  if (args.applyCosts) {
    for (let i = 0; i < args.lineIds.length; i++) {
      const cost = args.plan.lineCosts[i];
      if (cost == null) continue;
      await client.query(
        `UPDATE purchase_items SET acquisition_cost = $1 WHERE id = $2 AND purchase_id = $3`,
        [cost, args.lineIds[i], args.purchaseId]
      );
    }
    for (const row of args.plan.allocations) {
      await client.query(
        `INSERT INTO purchase_charge_allocations (business_id, purchase_charge_id, purchase_item_id, amount)
         VALUES ($1,$2,$3,$4)`,
        [args.businessId, chargeIds[row.chargeIndex], args.lineIds[row.lineIndex], row.amount]
      );
    }
  }
  await client.query(
    `UPDATE purchases SET acquisition_costs_capitalized = $1 WHERE id = $2 AND business_id = $3`,
    [args.applyCosts && args.plan.capitalized, args.purchaseId, args.businessId]
  );
}

/** Drafts store charges without a cost. Finalizing applies the cost once, before the voucher is posted. */
export async function applyStoredAcquisition(client: PoolClient, purchaseId: string, businessId: string): Promise<void> {
  const purchase = await client.query<{
    itc_eligible: boolean | null;
    document_type: string | null;
    bill_date: string | null;
    igst_total: string | null;
    cgst_total: string | null;
  }>(
    `SELECT itc_eligible, document_type, bill_date::text, igst_total::text, cgst_total::text
       FROM purchases WHERE id = $1 AND business_id = $2 FOR UPDATE`,
    [purchaseId, businessId]
  );
  const header = purchase.rows[0];
  if (!header || header.document_type === 'supplier_credit_note') return;
  const posted = await client.query(
    `SELECT 1 FROM ledger_entry_lines
      WHERE business_id = $1 AND voucher_id = $2 AND voucher_type = 'purchase' LIMIT 1`,
    [businessId, purchaseId]
  );
  if (posted.rows.length > 0) return;
  if ((await getInventoryModel(client, businessId)) !== 'perpetual') return;
  const items = await client.query<{
    id: string;
    taxable_value: string;
    tax_amount: string;
    cess_amount: string;
    quantity: string;
    line_item_type: string | null;
    itc_type: string | null;
    acquisition_cost: string | null;
  }>(
    `SELECT id, taxable_value, tax_amount, cess_amount, quantity, line_item_type, itc_type, acquisition_cost
       FROM purchase_items WHERE purchase_id = $1 ORDER BY id`,
    [purchaseId]
  );
  if (items.rows.some((row) => row.acquisition_cost != null)) return;
  const charges = await client.query<{
    purpose: string | null;
    classification: string;
    hsn_sac: string | null;
    tax_rate: string;
    taxable_value: string;
  }>(
    `SELECT purpose, classification, hsn_sac, tax_rate::text, taxable_value::text
       FROM purchase_charges WHERE purchase_id = $1 ORDER BY sort_order`,
    [purchaseId]
  );
  const plan = planAcquisitionCosts({
    lines: items.rows.map((row) => ({
      taxable: Number(row.taxable_value) || 0,
      tax: Number(row.tax_amount) || 0,
      cess: Number(row.cess_amount) || 0,
      quantity: Number(row.quantity) || 0,
      stock: row.line_item_type !== 'service' && row.itc_type !== 'capital_goods',
      capital: row.itc_type === 'capital_goods',
    })),
    charges: charges.rows.map((row) => ({
      purpose: row.purpose,
      amount: Number(row.taxable_value) || 0,
      classification: row.classification,
      hsn_sac: row.hsn_sac,
      tax_rate: Number(row.tax_rate) || 0,
    })),
    itcEligible: header.itc_eligible !== false,
    capitalize: true,
    intraState: !(Number(header.igst_total) > 0 && !(Number(header.cgst_total) > 0)),
    billDate: header.bill_date,
  });
  await savePurchaseAcquisition(client, {
    purchaseId,
    businessId,
    lineIds: items.rows.map((row) => row.id),
    plan,
    applyCosts: true,
  });
}
