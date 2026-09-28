/**
 * Inter-Branch Transaction Utilities
 * Handles inter-branch transfers, invoices, and accounting
 */

import type { PoolClient } from 'pg';
import * as db from '@/lib/db';
import { getStateCode } from './gst-utils';
import { reserveFormattedDocumentNumber } from '@/lib/invoices/document-counter';
import {
  insertVoucherLines,
  requireAccountByCode,
  round2,
  type VoucherLine,
} from '@/lib/accounting/voucher-posting';
import {
  computeGoodsCost,
  getInventoryModel,
  postCostOfGoods,
  weightedAverageCosts,
} from '@/lib/inventory/cogs-posting';

export interface BranchInfo {
  id: string;
  name: string;
  gstin?: string;
  state_code?: string;
  state?: string;
  business_id: string;
}

export interface WarehouseInfo {
  id: string;
  name: string;
  branch_id?: string;
  business_id: string;
}

/**
 * Get warehouse with branch information
 */
export async function getWarehouseWithBranch(warehouseId: string): Promise<WarehouseInfo & { branch?: BranchInfo }> {
  const warehouse = await db.queryOne<WarehouseInfo & { branch_id: string }>(`
    SELECT 
      w.id,
      w.name,
      COALESCE(
        w.branch_id,
        (SELECT bw.branch_id FROM branch_warehouses bw
          WHERE bw.warehouse_id = w.id
          ORDER BY bw.is_primary DESC NULLS LAST
          LIMIT 1)
      ) AS branch_id,
      w.business_id
    FROM warehouses w
    WHERE w.id = $1
  `, [warehouseId]);

  if (!warehouse) {
    throw new Error(`Warehouse ${warehouseId} not found`);
  }

  // A branch without its own GSTIN trades under the head-office registration.
  let branch: BranchInfo | undefined;
  if (warehouse.branch_id) {
    branch = await db.queryOne<BranchInfo>(`
      SELECT 
        br.id,
        br.name,
        COALESCE(NULLIF(TRIM(br.gstin), ''), b.gstin) AS gstin,
        CASE WHEN NULLIF(TRIM(br.gstin), '') IS NOT NULL
             THEN COALESCE(br.state_code, LEFT(TRIM(br.gstin), 2))
             ELSE COALESCE(b.state_code, LEFT(TRIM(b.gstin), 2)) END AS state_code,
        CASE WHEN NULLIF(TRIM(br.gstin), '') IS NOT NULL THEN br.state ELSE b.state END AS state,
        br.business_id
      FROM branches br
      JOIN businesses b ON b.id = br.business_id
      WHERE br.id = $1
    `, [warehouse.branch_id]) ?? undefined;
  }

  return {
    ...warehouse,
    branch,
  };
}

/**
 * Check if transfer is inter-branch
 */
export async function isInterBranchTransfer(
  fromWarehouseId: string,
  toWarehouseId: string
): Promise<{
  isInterBranch: boolean;
  fromWarehouse: WarehouseInfo & { branch?: BranchInfo };
  toWarehouse: WarehouseInfo & { branch?: BranchInfo };
  isInterState: boolean;
  hasDifferentGstin: boolean;
}> {
  const fromWarehouse = await getWarehouseWithBranch(fromWarehouseId);
  const toWarehouse = await getWarehouseWithBranch(toWarehouseId);

  const isInterBranch = 
    fromWarehouse.branch?.id && 
    toWarehouse.branch?.id && 
    fromWarehouse.branch.id !== toWarehouse.branch.id;

  const isInterState = 
    fromWarehouse.branch?.state_code && 
    toWarehouse.branch?.state_code &&
    fromWarehouse.branch.state_code !== toWarehouse.branch.state_code;

  const hasDifferentGstin = 
    fromWarehouse.branch?.gstin && 
    toWarehouse.branch?.gstin &&
    fromWarehouse.branch.gstin !== toWarehouse.branch.gstin;

  return {
    isInterBranch: isInterBranch || false,
    fromWarehouse,
    toWarehouse,
    isInterState: isInterState || false,
    hasDifferentGstin: hasDifferentGstin || false,
  };
}

/**
 * Get or create branch-as-customer
 */
export async function getOrCreateBranchCustomer(
  businessId: string,
  branchId: string,
  client?: PoolClient
): Promise<string> {
  const one = async <T,>(text: string, params: unknown[]): Promise<T | null> =>
    client ? ((await client.query(text, params)).rows[0] as T) ?? null : await db.queryOne<any>(text, params);

  // Check if customer already exists for this branch
  const existingCustomer = await one<{ id: string }>(`
    SELECT id FROM customers
    WHERE business_id = $1 AND branch_id = $2
    LIMIT 1
  `, [businessId, branchId]);

  if (existingCustomer) {
    return existingCustomer.id;
  }

  const branch = await one<BranchInfo>(`
    SELECT br.id, br.name,
           COALESCE(NULLIF(TRIM(br.gstin), ''), b.gstin) AS gstin,
           CASE WHEN NULLIF(TRIM(br.gstin), '') IS NOT NULL
                THEN COALESCE(br.state_code, LEFT(TRIM(br.gstin), 2))
                ELSE COALESCE(b.state_code, LEFT(TRIM(b.gstin), 2)) END AS state_code,
           CASE WHEN NULLIF(TRIM(br.gstin), '') IS NOT NULL THEN br.state ELSE b.state END AS state,
           br.business_id
    FROM branches br
    JOIN businesses b ON b.id = br.business_id
    WHERE br.id = $1 AND br.business_id = $2
  `, [branchId, businessId]);

  if (!branch) {
    throw new Error(`Branch ${branchId} not found`);
  }

  // Create customer for branch
  const customer = await one<{ id: string }>(`
    INSERT INTO customers (
      business_id,
      branch_id,
      name,
      gstin,
      state,
      state_code,
      customer_type,
      is_active,
      created_at,
      updated_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    RETURNING id
  `, [
    businessId,
    branchId,
    `Branch: ${branch.name}`,
    branch.gstin || null,
    branch.state || null,
    branch.state_code || null,
    'branch', // Special customer type
    true,
  ]);

  if (!customer) {
    throw new Error('Failed to create inter-branch customer');
  }

  return customer.id;
}

/**
 * Calculate GST for inter-branch transfer
 */
export function calculateInterBranchGST(
  items: Array<{ unit_price: number; qty: number; tax_rate: number; discount?: number }>,
  fromStateCode: string,
  toStateCode: string
): {
  subtotal: number;
  discountTotal: number;
  taxableValue: number;
  cgstTotal: number;
  sgstTotal: number;
  igstTotal: number;
  taxTotal: number;
  grandTotal: number;
  items: Array<{
    taxableValue: number;
    cgst: number;
    sgst: number;
    igst: number;
    taxAmount: number;
    lineTotal: number;
  }>;
} {
  const isInterState = fromStateCode !== toStateCode;
  let subtotal = 0;
  let discountTotal = 0;
  let cgstTotal = 0;
  let sgstTotal = 0;
  let igstTotal = 0;

  const processedItems = items.map(item => {
    const itemSubtotal = item.unit_price * item.qty;
    const itemDiscount = (itemSubtotal * (item.discount || 0)) / 100;
    const taxableValue = itemSubtotal - itemDiscount;
    
    subtotal += itemSubtotal;
    discountTotal += itemDiscount;

    let cgst = 0;
    let sgst = 0;
    let igst = 0;
    const taxAmount = (taxableValue * item.tax_rate) / 100;

    if (isInterState) {
      // Inter-state: IGST
      igst = taxAmount;
      igstTotal += igst;
    } else {
      // Intra-state: CGST + SGST
      cgst = taxAmount / 2;
      sgst = taxAmount / 2;
      cgstTotal += cgst;
      sgstTotal += sgst;
    }

    const lineTotal = taxableValue + taxAmount;

    return {
      taxableValue,
      cgst,
      sgst,
      igst,
      taxAmount,
      lineTotal,
    };
  });

  const taxTotal = cgstTotal + sgstTotal + igstTotal;
  const grandTotal = subtotal - discountTotal + taxTotal;

  return {
    subtotal,
    discountTotal,
    taxableValue: subtotal - discountTotal,
    cgstTotal,
    sgstTotal,
    igstTotal,
    taxTotal,
    grandTotal,
    items: processedItems,
  };
}

/**
 * Check if e-way bill is required
 */
export function isEwayBillRequired(
  transferValue: number,
  isInterState: boolean
): boolean {
  // E-way bill required for inter-state movement > ₹50,000
  return isInterState && transferValue > 50000;
}

type InterBranchItem = {
  item_id?: string;
  description: string;
  qty: number;
  unit: string;
  unit_price: number;
  tax_rate: number;
  discount?: number;
  hsn_sac?: string;
};

async function interBranchAccounts(client: PoolClient, businessId: string) {
  return {
    receivable: await requireAccountByCode(client, businessId, '1109', 'Inter-Branch Receivables'),
    sales: await requireAccountByCode(client, businessId, '4103', 'Inter-Branch Sales'),
    payable: await requireAccountByCode(client, businessId, '2111', 'Inter-Branch Payables'),
    purchases: await requireAccountByCode(client, businessId, '5103', 'Inter-Branch Purchases'),
  };
}

async function gstHeadLines(
  client: PoolClient,
  businessId: string,
  side: 'output' | 'input',
  t: { cgst: number; sgst: number; igst: number },
  label: string
): Promise<VoucherLine[]> {
  const codes = side === 'output'
    ? { cgst: '2150', sgst: '2151', igst: '2152' }
    : { cgst: '1110', sgst: '1111', igst: '1112' };
  const out: VoucherLine[] = [];
  for (const head of ['cgst', 'sgst', 'igst'] as const) {
    const amt = round2(t[head]);
    if (amt <= 0) continue;
    const name = `${side === 'output' ? 'Output' : 'Input'} ${head.toUpperCase()}`;
    const id = await requireAccountByCode(client, businessId, codes[head], name);
    out.push(side === 'output'
      ? { accountId: id, debit: 0, credit: amt, narration: `${name} - ${label}` }
      : { accountId: id, debit: amt, credit: 0, narration: `${name} - ${label}` });
  }
  return out;
}

/**
 * Create the inter-branch tax invoice (distinct persons under s.25(4)) on the caller's
 * transaction: Dr Inter-Branch Receivable / Cr Inter-Branch Sales + Output GST, and
 * for perpetual inventory Dr COGS / Cr Inventory at weighted-average cost.
 */
export async function createInterBranchInvoice(
  client: PoolClient,
  params: {
    businessId: string;
    fromBranchId: string;
    toBranchId: string;
    transferId: string;
    transferNumber: string;
    transferDate: Date | string;
    items: InterBranchItem[];
    notes?: string;
    ewayBillNumber?: string;
    ewayBillDate?: Date | string;
    createdBy?: string | null;
  }
): Promise<{ invoiceId: string; invoiceNumber: string }> {
  const branches = await client.query<BranchInfo>(
    `SELECT br.id, br.name,
            COALESCE(NULLIF(TRIM(br.gstin), ''), b.gstin) AS gstin,
            CASE WHEN NULLIF(TRIM(br.gstin), '') IS NOT NULL
                 THEN COALESCE(br.state_code, LEFT(TRIM(br.gstin), 2))
                 ELSE COALESCE(b.state_code, LEFT(TRIM(b.gstin), 2)) END AS state_code,
            CASE WHEN NULLIF(TRIM(br.gstin), '') IS NOT NULL THEN br.state ELSE b.state END AS state,
            br.business_id
       FROM branches br
       JOIN businesses b ON b.id = br.business_id
      WHERE br.id = ANY($1::uuid[]) AND br.business_id = $2`,
    [[params.fromBranchId, params.toBranchId], params.businessId]
  );
  const fromBranch = branches.rows.find((b) => b.id === params.fromBranchId);
  const toBranch = branches.rows.find((b) => b.id === params.toBranchId);
  if (!fromBranch || !toBranch) throw new Error('Source or destination branch not found');

  const customerId = await getOrCreateBranchCustomer(params.businessId, params.toBranchId, client);
  const fromStateCode = fromBranch.state_code || getStateCode(fromBranch.state || '') || '';
  const toStateCode = toBranch.state_code || getStateCode(toBranch.state || '') || '';
  const gst = calculateInterBranchGST(params.items, fromStateCode, toStateCode);
  const r = (n: number) => round2(n);
  gst.cgstTotal = r(gst.cgstTotal);
  gst.sgstTotal = r(gst.sgstTotal);
  gst.igstTotal = r(gst.igstTotal);
  gst.taxableValue = r(gst.taxableValue);
  gst.taxTotal = r(gst.cgstTotal + gst.sgstTotal + gst.igstTotal);
  gst.grandTotal = r(gst.taxableValue + gst.taxTotal);

  const invoiceNumber = await reserveFormattedDocumentNumber(client, params.fromBranchId, 'tax_invoice');
  const invoiceResult = await client.query(
    `INSERT INTO invoices (
       business_id, branch_id, customer_id, invoice_number, invoice_date, status, payment_status,
       document_type, supply_type, subtotal, discount_total, tax_total, cgst_total, sgst_total,
       igst_total, grand_total, paid_amount, balance_amount, place_of_supply_state_code,
       eway_bill_number, eway_bill_date, notes, created_by, is_editable
     )
     VALUES ($1,$2,$3,$4,$5,'final','unpaid','inter_branch_invoice','b2b',$6,$7,$8,$9,$10,$11,$12,0,$12,$13,$14,$15,$16,$17,false)
     RETURNING id, invoice_number`,
    [
      params.businessId, params.fromBranchId, customerId, invoiceNumber, params.transferDate,
      r(gst.subtotal), r(gst.discountTotal), r(gst.taxTotal), r(gst.cgstTotal), r(gst.sgstTotal),
      r(gst.igstTotal), r(gst.grandTotal), toStateCode || null,
      params.ewayBillNumber || null, params.ewayBillDate || null,
      params.notes || `Inter-branch transfer: ${params.transferNumber}`, params.createdBy || null,
    ]
  );
  const invoice = invoiceResult.rows[0] as { id: string; invoice_number: string };

  for (let i = 0; i < params.items.length; i++) {
    const item = params.items[i];
    const line = gst.items[i];
    const gross = item.unit_price * item.qty;
    await client.query(
      `INSERT INTO invoice_items (
         invoice_id, item_id, item_name, description, hsn_sac, quantity, unit, unit_price,
         discount_percent, discount_amount, tax_rate, tax_amount, taxable_value,
         cgst_amount, sgst_amount, igst_amount, line_total, sort_order
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
      [
        invoice.id, item.item_id || null, item.description.slice(0, 255), item.description,
        item.hsn_sac || null, item.qty, item.unit || 'PCS', item.unit_price,
        item.discount || 0, r(gross - line.taxableValue), item.tax_rate, r(line.taxAmount),
        r(line.taxableValue), r(line.cgst), r(line.sgst), r(line.igst), r(line.lineTotal), i,
      ]
    );
  }

  await client.query(`UPDATE stock_transfers SET inter_branch_invoice_id = $1 WHERE id = $2`, [invoice.id, params.transferId]);
  await client.query(
    `UPDATE customers SET current_balance = COALESCE(current_balance, 0) + $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
    [r(gst.grandTotal), customerId]
  );

  const acc = await interBranchAccounts(client, params.businessId);
  const label = `Inter-branch invoice ${invoice.invoice_number}`;
  const lines: VoucherLine[] = [
    { accountId: acc.receivable, debit: r(gst.grandTotal), credit: 0, narration: label },
    { accountId: acc.sales, debit: 0, credit: r(gst.taxableValue), narration: label },
    ...(await gstHeadLines(client, params.businessId, 'output', { cgst: gst.cgstTotal, sgst: gst.sgstTotal, igst: gst.igstTotal }, label)),
  ];
  await insertVoucherLines(client, {
    businessId: params.businessId,
    branchId: params.fromBranchId,
    voucherId: invoice.id,
    voucherType: 'invoice',
    entryDate: params.transferDate,
    reference: invoice.invoice_number,
    lines,
  });

  if ((await getInventoryModel(client, params.businessId)) === 'perpetual') {
    const cost = await computeGoodsCost(
      client,
      params.businessId,
      params.items.map((i) => ({ itemId: i.item_id, quantity: Number(i.qty) || 0 })),
      params.transferDate,
      params.fromBranchId
    );
    await postCostOfGoods(client, {
      businessId: params.businessId,
      voucherType: 'invoice',
      voucherId: invoice.id,
      amount: cost,
      entryDate: params.transferDate,
      reference: invoice.invoice_number,
      branchId: params.fromBranchId,
      direction: 'sale',
    });
  }

  return { invoiceId: invoice.id, invoiceNumber: invoice.invoice_number };
}

/**
 * Creates the inter-branch invoice for an approved transfer between branches with
 * different GSTINs, if it does not exist yet. Returns the invoice id (or null).
 */
export async function ensureInterBranchInvoiceForTransfer(
  client: PoolClient,
  transferId: string,
  opts: { ewayBillNumber?: string; ewayBillDate?: string; createdBy?: string | null } = {}
): Promise<string | null> {
  const t = await client.query(
    `SELECT id, business_id, transfer_number, transfer_date, from_location_id, to_location_id,
            inter_branch_invoice_id, notes, created_by
       FROM stock_transfers WHERE id = $1`,
    [transferId]
  );
  const transfer = t.rows[0];
  if (!transfer) throw new Error('Transfer not found');
  if (transfer.inter_branch_invoice_id) return transfer.inter_branch_invoice_id;

  const info = await isInterBranchTransfer(transfer.from_location_id, transfer.to_location_id);
  if (!(info.isInterBranch && info.hasDifferentGstin && info.fromWarehouse.branch && info.toWarehouse.branch)) {
    return null;
  }

  const rows = await client.query(
    `SELECT sti.item_id, COALESCE(sti.quantity_requested, sti.qty) AS qty, sti.unit, sti.cost_snapshot,
            i.name, i.hsn_sac, i.tax_rate, i.purchase_price
       FROM stock_transfer_items sti
       JOIN items i ON i.id = sti.item_id
      WHERE sti.transfer_id = $1`,
    [transferId]
  );
  if (rows.rows.length === 0) return null;

  const wac = await weightedAverageCosts(
    client,
    transfer.business_id,
    rows.rows.map((r: any) => r.item_id),
    transfer.transfer_date,
    info.fromWarehouse.branch.id
  );
  const items: InterBranchItem[] = rows.rows.map((r: any) => ({
    item_id: r.item_id,
    description: r.name || 'Item',
    qty: Number(r.qty) || 0,
    unit: r.unit || 'PCS',
    // Rule 28 (2nd proviso): with full ITC at the recipient the declared value is accepted. Declare the
    // sending branch's weighted-average cost so the invoice matches the COGS it posts; cost_snapshot
    // is the master price captured at creation and is only a fallback.
    unit_price: round2(wac.get(r.item_id) || Number(r.cost_snapshot) || Number(r.purchase_price) || 0),
    tax_rate: Number(r.tax_rate) || 0,
    hsn_sac: r.hsn_sac || undefined,
  }));

  const inv = await createInterBranchInvoice(client, {
    businessId: transfer.business_id,
    fromBranchId: info.fromWarehouse.branch.id,
    toBranchId: info.toWarehouse.branch.id,
    transferId,
    transferNumber: transfer.transfer_number,
    transferDate: transfer.transfer_date,
    items,
    notes: transfer.notes || undefined,
    ewayBillNumber: opts.ewayBillNumber,
    ewayBillDate: opts.ewayBillDate,
    createdBy: opts.createdBy ?? transfer.created_by,
  });
  return inv.invoiceId;
}

/**
 * Receiving branch books the inter-branch invoice on the caller's transaction:
 * Dr Inter-Branch Purchases + Input GST / Cr Inter-Branch Payable, and for perpetual
 * inventory moves the goods at cost: Dr Inventory / Cr Inter-Branch Purchases.
 * Posts once per invoice.
 */
export async function createInterBranchPurchaseEntries(
  client: PoolClient,
  params: {
    businessId: string;
    toBranchId: string;
    invoiceId: string;
    invoiceDate: Date | string;
    inventoryAmount?: number;
  }
): Promise<void> {
  const existing = await client.query(
    `SELECT 1 FROM ledger_entry_lines WHERE business_id = $1 AND voucher_id = $2 AND voucher_type = 'inter_branch_receipt' LIMIT 1`,
    [params.businessId, params.invoiceId]
  );
  if (existing.rows.length > 0) return;

  const inv = await client.query(
    `SELECT invoice_number, subtotal, discount_total, grand_total, cgst_total, sgst_total, igst_total
       FROM invoices WHERE id = $1 AND business_id = $2`,
    [params.invoiceId, params.businessId]
  );
  const invoice = inv.rows[0];
  if (!invoice) throw new Error('Inter-branch invoice not found');

  const acc = await interBranchAccounts(client, params.businessId);
  const taxable = round2(Number(invoice.subtotal) - Number(invoice.discount_total || 0));
  const label = `Inter-branch receipt ${invoice.invoice_number}`;
  const inputLines = await gstHeadLines(
    client,
    params.businessId,
    'input',
    { cgst: Number(invoice.cgst_total || 0), sgst: Number(invoice.sgst_total || 0), igst: Number(invoice.igst_total || 0) },
    label
  );
  const payable = round2(taxable + inputLines.reduce((s, l) => s + l.debit, 0));
  const lines: VoucherLine[] = [
    { accountId: acc.purchases, debit: taxable, credit: 0, narration: label },
    ...inputLines,
    { accountId: acc.payable, debit: 0, credit: payable, narration: label },
  ];

  const inventoryAmount = round2(params.inventoryAmount ?? 0);
  if (inventoryAmount > 0 && (await getInventoryModel(client, params.businessId)) === 'perpetual') {
    const inventory = await requireAccountByCode(client, params.businessId, '1104', 'Inventory');
    lines.push(
      { accountId: inventory, debit: inventoryAmount, credit: 0, narration: `Stock received - ${label}` },
      { accountId: acc.purchases, debit: 0, credit: inventoryAmount, narration: `Stock received - ${label}` }
    );
  }

  await insertVoucherLines(client, {
    businessId: params.businessId,
    branchId: params.toBranchId,
    voucherId: params.invoiceId,
    voucherType: 'inter_branch_receipt',
    entryDate: params.invoiceDate,
    reference: invoice.invoice_number,
    lines,
  });
}
