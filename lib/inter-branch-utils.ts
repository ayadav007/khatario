/**
 * Inter-Branch Transaction Utilities
 * Handles inter-branch transfers, invoices, and accounting
 */

import * as db from '@/lib/db';
import { getPool } from '@/lib/db';
import { createInvoiceLedgerEntries } from './ledger-utils';
import { getStateCode } from './gst-utils';

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
      w.branch_id,
      w.business_id
    FROM warehouses w
    WHERE w.id = $1
  `, [warehouseId]);

  if (!warehouse) {
    throw new Error(`Warehouse ${warehouseId} not found`);
  }

  let branch: BranchInfo | undefined;
  if (warehouse.branch_id) {
    branch = await db.queryOne<BranchInfo>(`
      SELECT 
        id,
        name,
        gstin,
        state_code,
        state,
        business_id
      FROM branches
      WHERE id = $1
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
  branchId: string
): Promise<string> {
  // Check if customer already exists for this branch
  const existingCustomer = await db.queryOne<{ id: string }>(`
    SELECT id FROM customers
    WHERE business_id = $1 AND branch_id = $2
    LIMIT 1
  `, [businessId, branchId]);

  if (existingCustomer) {
    return existingCustomer.id;
  }

  // Get branch details
  const branch = await db.queryOne<BranchInfo>(`
    SELECT id, name, gstin, state_code, state, business_id
    FROM branches
    WHERE id = $1 AND business_id = $2
  `, [branchId, businessId]);

  if (!branch) {
    throw new Error(`Branch ${branchId} not found`);
  }

  // Create customer for branch
  const customer = await db.queryOne<{ id: string }>(`
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

/**
 * Create inter-branch invoice
 */
export async function createInterBranchInvoice(params: {
  businessId: string;
  fromBranchId: string;
  toBranchId: string;
  transferId: string;
  transferNumber: string;
  transferDate: Date | string;
  items: Array<{
    item_id?: string;
    description: string;
    qty: number;
    unit: string;
    unit_price: number;
    tax_rate: number;
    discount?: number;
    hsn_sac?: string;
  }>;
  notes?: string;
  ewayBillNumber?: string;
  ewayBillDate?: Date | string;
}): Promise<{ invoiceId: string; invoiceNumber: string }> {
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Get branch details
    const fromBranch = await db.queryOne<BranchInfo>(`
      SELECT id, name, gstin, state_code, state, business_id
      FROM branches
      WHERE id = $1 AND business_id = $2
    `, [params.fromBranchId, params.businessId]);

    const toBranch = await db.queryOne<BranchInfo>(`
      SELECT id, name, gstin, state_code, state, business_id
      FROM branches
      WHERE id = $1 AND business_id = $2
    `, [params.toBranchId, params.businessId]);

    if (!fromBranch || !toBranch) {
      throw new Error('Source or destination branch not found');
    }

    // Get or create branch customer
    const customerId = await getOrCreateBranchCustomer(params.businessId, params.toBranchId);

    // Calculate GST
    const fromStateCode = fromBranch.state_code || '';
    const toStateCode = toBranch.state_code || '';
    const gstCalculation = calculateInterBranchGST(
      params.items,
      fromStateCode,
      toStateCode
    );

    // Get branch for invoice numbering
    const branch = await db.queryOne<{ invoice_prefix?: string; next_invoice_number: number }>(`
      SELECT invoice_prefix, next_invoice_number
      FROM branches
      WHERE id = $1
    `, [params.fromBranchId]);

    const invoicePrefix = branch?.invoice_prefix || 'IB-INV';
    const invoiceNumber = `${invoicePrefix}-${String(branch?.next_invoice_number || 1).padStart(6, '0')}`;

    // Create invoice
    const invoiceResult = await client.query(`
      INSERT INTO invoices (
        business_id,
        branch_id,
        customer_id,
        invoice_number,
        invoice_date,
        status,
        payment_status,
        document_type,
        supply_type,
        subtotal,
        discount_total,
        tax_total,
        cgst_total,
        sgst_total,
        igst_total,
        grand_total,
        place_of_supply_state_code,
        eway_bill_number,
        eway_bill_date,
        notes,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      RETURNING id, invoice_number
    `, [
      params.businessId,
      params.fromBranchId,
      customerId,
      invoiceNumber,
      params.transferDate,
      'final', // Inter-branch invoices are final
      'unpaid', // Inter-branch invoices are typically unpaid initially
      'inter_branch_invoice',
      'b2b',
      gstCalculation.subtotal,
      gstCalculation.discountTotal,
      gstCalculation.taxTotal,
      gstCalculation.cgstTotal,
      gstCalculation.sgstTotal,
      gstCalculation.igstTotal,
      gstCalculation.grandTotal,
      toStateCode,
      params.ewayBillNumber || null,
      params.ewayBillDate || null,
      params.notes || `Inter-branch transfer: ${params.transferNumber}`,
    ]);

    const invoice = invoiceResult.rows[0];

    // Create invoice items
    for (let i = 0; i < params.items.length; i++) {
      const item = params.items[i];
      const processedItem = gstCalculation.items[i];

      await client.query(`
        INSERT INTO invoice_items (
          invoice_id,
          item_id,
          description,
          qty,
          unit,
          unit_price,
          discount,
          tax_rate,
          tax_amount,
          cgst_amount,
          sgst_amount,
          igst_amount,
          line_total,
          hsn_sac,
          sort_order
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      `, [
        invoice.id,
        item.item_id || null,
        item.description,
        item.qty,
        item.unit,
        item.unit_price,
        item.discount || 0,
        item.tax_rate,
        processedItem.taxAmount,
        processedItem.cgst,
        processedItem.sgst,
        processedItem.igst,
        processedItem.lineTotal,
        item.hsn_sac || null,
        i,
      ]);
    }

    // Update branch invoice number
    await client.query(`
      UPDATE branches
      SET next_invoice_number = next_invoice_number + 1
      WHERE id = $1
    `, [params.fromBranchId]);

    // Link invoice to transfer
    await client.query(`
      UPDATE stock_transfers
      SET inter_branch_invoice_id = $1
      WHERE id = $2
    `, [invoice.id, params.transferId]);

    // Update customer receivable
    await client.query(`
      UPDATE customers
      SET total_receivable = COALESCE(total_receivable, 0) + $1
      WHERE id = $2
    `, [gstCalculation.grandTotal, customerId]);

    // Create ledger entries for inter-branch invoice
    try {
      const { createLedgerEntryLine, getDefaultAccounts } = await import('./ledger-utils');
      const { getAccountByName } = await import('./ledger-utils');
      
      const accounts = await getDefaultAccounts(params.businessId);
      
      // Get inter-branch accounts
      const interBranchReceivable = await getAccountByName(params.businessId, 'Inter-Branch Receivables');
      const interBranchSales = await getAccountByName(params.businessId, 'Inter-Branch Sales');
      
      if (!interBranchReceivable || !interBranchSales) {
        console.warn('Inter-branch accounts not found. Using default accounts.');
      }

      // Calculate COGS
      let totalCogsAmount = 0;
      for (const item of params.items) {
        if (item.item_id) {
          const itemData = await client.query(`
            SELECT purchase_price, item_type FROM items WHERE id = $1
          `, [item.item_id]);
          
          if (itemData.rows[0]?.item_type === 'goods' && itemData.rows[0]?.purchase_price) {
            const itemCost = Number(itemData.rows[0].purchase_price) || 0;
            totalCogsAmount += itemCost * item.qty;
          }
        }
      }

      // Entry 1: Debit Inter-Branch Receivable (or Accounts Receivable if not found)
      await createLedgerEntryLine({
        businessId: params.businessId,
        voucherId: invoice.id,
        voucherType: 'invoice',
        accountId: interBranchReceivable?.id || accounts.accountsReceivable?.id || '',
        entryDate: params.transferDate,
        debit: gstCalculation.grandTotal,
        credit: 0,
        narration: `Inter-branch sale - Invoice ${invoice.invoice_number}`,
        referenceNumber: invoice.invoice_number,
        branchId: params.fromBranchId,
      });

      // Entry 2: Credit Inter-Branch Sales (or Sales if not found)
      await createLedgerEntryLine({
        businessId: params.businessId,
        voucherId: invoice.id,
        voucherType: 'invoice',
        accountId: interBranchSales?.id || accounts.sales?.id || '',
        entryDate: params.transferDate,
        debit: 0,
        credit: gstCalculation.subtotal - gstCalculation.discountTotal,
        narration: `Inter-branch sales - Invoice ${invoice.invoice_number}`,
        referenceNumber: invoice.invoice_number,
        branchId: params.fromBranchId,
      });

      // Entry 3 & 4: COGS and Inventory (if applicable)
      if (totalCogsAmount > 0 && accounts.cogs && accounts.inventory) {
        // Debit COGS
        await createLedgerEntryLine({
          businessId: params.businessId,
          voucherId: invoice.id,
          voucherType: 'invoice',
          accountId: accounts.cogs.id,
          entryDate: params.transferDate,
          debit: totalCogsAmount,
          credit: 0,
          narration: `COGS - Inter-branch Invoice ${invoice.invoice_number}`,
          referenceNumber: invoice.invoice_number,
          branchId: params.fromBranchId,
        });

        // Credit Inventory
        await createLedgerEntryLine({
          businessId: params.businessId,
          voucherId: invoice.id,
          voucherType: 'invoice',
          accountId: accounts.inventory.id,
          entryDate: params.transferDate,
          debit: 0,
          credit: totalCogsAmount,
          narration: `Inventory reduction - Inter-branch Invoice ${invoice.invoice_number}`,
          referenceNumber: invoice.invoice_number,
          branchId: params.fromBranchId,
        });
      }
    } catch (ledgerError) {
      console.error('Error creating ledger entries for inter-branch invoice:', ledgerError);
      // Don't fail invoice creation if ledger fails
    }

    await client.query('COMMIT');

    return {
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoice_number,
    };
  } catch (error: any) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Create inter-branch accounting entries for destination branch
 */
export async function createInterBranchPurchaseEntries(params: {
  businessId: string;
  toBranchId: string;
  invoiceId: string;
  invoiceNumber: string;
  invoiceDate: Date | string;
  grandTotal: number;
  subtotal: number;
  inventoryAmount?: number;
}): Promise<void> {
  const { createLedgerEntryLine } = await import('./ledger-utils');
  const { getDefaultAccounts } = await import('./ledger-utils');

  const accounts = await getDefaultAccounts(params.businessId);

  // Get inter-branch accounts
  const { getAccountByName } = await import('./ledger-utils');
  const interBranchPayable = await getAccountByName(params.businessId, 'Inter-Branch Payables');
  const interBranchPurchases = await getAccountByName(params.businessId, 'Inter-Branch Purchases');

  if (!interBranchPayable || !interBranchPurchases) {
    console.warn('Inter-branch accounts not found. Skipping purchase entries.');
    return;
  }

  // Entry 1: Debit Inter-Branch Purchases
  await createLedgerEntryLine({
    businessId: params.businessId,
    voucherId: params.invoiceId,
    voucherType: 'purchase',
    accountId: interBranchPurchases.id,
    entryDate: params.invoiceDate,
    debit: params.subtotal,
    credit: 0,
    narration: `Inter-branch purchase - Invoice ${params.invoiceNumber}`,
    referenceNumber: params.invoiceNumber,
    branchId: params.toBranchId,
  });

  // Entry 2: Credit Inter-Branch Payable
  await createLedgerEntryLine({
    businessId: params.businessId,
    voucherId: params.invoiceId,
    voucherType: 'purchase',
    accountId: interBranchPayable.id,
    entryDate: params.invoiceDate,
    debit: 0,
    credit: params.grandTotal,
    narration: `Inter-branch payable - Invoice ${params.invoiceNumber}`,
    referenceNumber: params.invoiceNumber,
    branchId: params.toBranchId,
  });

  // Entry 3: Debit Inventory (if applicable)
  if ((params.inventoryAmount ?? 0) > 0 && accounts.inventory) {
    await createLedgerEntryLine({
      businessId: params.businessId,
      voucherId: params.invoiceId,
      voucherType: 'purchase',
      accountId: accounts.inventory.id,
      entryDate: params.invoiceDate,
      debit: params.inventoryAmount ?? 0,
      credit: 0,
      narration: `Inventory addition - Inter-branch transfer ${params.invoiceNumber}`,
      referenceNumber: params.invoiceNumber,
      branchId: params.toBranchId,
    });

    // Entry 4: Credit Inter-Branch Purchases (transfer to inventory)
    await createLedgerEntryLine({
      businessId: params.businessId,
      voucherId: params.invoiceId,
      voucherType: 'purchase',
      accountId: interBranchPurchases.id,
      entryDate: params.invoiceDate,
      debit: 0,
      credit: params.inventoryAmount ?? 0,
      narration: `Transfer to inventory - Inter-branch ${params.invoiceNumber}`,
      referenceNumber: params.invoiceNumber,
      branchId: params.toBranchId,
    });
  }
}
