import type { PoolClient } from 'pg';
import { createCreditNoteLedgerEntries } from '@/lib/ledger-utils';
import { computeLineGst, isZeroRatedWithoutTax, round2 } from '@/lib/invoices/line-gst';
import { adjustBranchItemStock, refreshItemGlobalStockFromBranches } from '@/lib/branch-stock';
import { recomputeInvoiceBalance } from '@/lib/invoices/invoice-balance';
import { refreshCreditNoteRefundStatus } from '@/lib/credit-notes/customer-credit';

/**
 * Sales return (credit note) posting, shared by POST /api/credit-notes and order returns.
 * Runs on the caller's open transaction: the caller has already checked permission, plan access,
 * GST filing and period lock, and commits or rolls back.
 *
 * Effects: credit note + lines, stock back in for goods lines (unless a line says `restock: false`,
 * e.g. damaged returns), customer balance down, linked invoice balance recomputed, ledger posted.
 */

export class CreditNoteCreateError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = 'CreditNoteCreateError';
  }
}

export type CreditNoteLineInput = {
  item_id?: string | null;
  item_name?: string | null;
  description?: string | null;
  qty?: number | string;
  quantity?: number | string;
  unit?: string | null;
  unit_price?: number | string;
  price?: number | string;
  discount_percent?: number | string;
  discount_amount?: number | string;
  discount?: number | string;
  tax_rate?: number | string;
  hsn_sac?: string | null;
  location_id?: string | null;
  /** false = the goods came back unsellable: no stock in, and their cost stays in COGS. */
  restock?: boolean;
};

export type CreateCreditNoteInput = {
  businessId: string;
  branchId: string;
  userId: string;
  customerId: string;
  invoiceId?: string | null;
  creditNoteNumber: string;
  creditNoteDate: string;
  originalInvoiceDate?: string | null;
  reason?: string | null;
  placeOfSupplyStateCode?: string | null;
  items: CreditNoteLineInput[];
  roundOff?: number | string | null;
  refundStatus?: string;
  refundMode?: string | null;
  refundDate?: string | null;
  refundAmount?: number | string | null;
  notes?: string | null;
};

/** Next `CN-001` style number for the business. */
export async function nextCreditNoteNumber(client: Pick<PoolClient, 'query'>, businessId: string): Promise<string> {
  const maxRes = await client.query<{ max_used: string | null }>(
    `SELECT MAX(SUBSTRING(credit_note_number FROM '(\\d+)$')::bigint) AS max_used
       FROM credit_notes
      WHERE business_id = $1 AND credit_note_number ~ '\\d+$'`,
    [businessId],
  );
  const next = Number(maxRes.rows[0]?.max_used || 0) + 1;
  return `CN-${String(next).padStart(3, '0')}`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function createCreditNoteInTransaction(client: PoolClient, input: CreateCreditNoteInput): Promise<any> {
  const business_id = input.businessId;
  const finalBranchId = input.branchId;
  const customer_id = input.customerId;
  const invoice_id = input.invoiceId || null;
  const credit_note_number = input.creditNoteNumber;
  const credit_note_date = input.creditNoteDate;

  const businessRes = await client.query('SELECT state_code FROM businesses WHERE id = $1', [business_id]);
  if (businessRes.rows.length === 0) {
    throw new Error('Business not found');
  }

  const { resolveSupplierRegistration } = await import('@/lib/gst/registration');
  const businessStateCode =
    (await resolveSupplierRegistration(client, business_id, finalBranchId)).stateCode ||
    businessRes.rows[0].state_code ||
    '';

  let finalPosStateCode = input.placeOfSupplyStateCode || null;
  const customerRes = await client.query<{ state_code: string | null; gstin: string | null }>(
    'SELECT state_code, gstin FROM customers WHERE id = $1 AND business_id = $2',
    [customer_id, business_id],
  );
  const noteCustomer = customerRes.rows[0];
  if (!finalPosStateCode && noteCustomer) {
    finalPosStateCode = noteCustomer.state_code || (noteCustomer.gstin ? noteCustomer.gstin.trim().slice(0, 2) : null);
  }

  if (!noteCustomer) {
    throw new CreditNoteCreateError(404, 'CUSTOMER_NOT_FOUND', 'Customer not found');
  }
  if (noteCustomer.gstin && noteCustomer.gstin.trim() && !invoice_id) {
    throw new CreditNoteCreateError(
      400,
      'ORIGINAL_INVOICE_REQUIRED',
      'A credit note to a registered customer must reference the original invoice (s.34 CGST Act; reported in GSTR-1 CDNR)',
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let invoice: any = null;
  const invoicedByItem = new Map<string, { qty: number; taxRate: number }>();
  if (invoice_id) {
    const invRes = await client.query(
      `SELECT * FROM invoices WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL FOR UPDATE`,
      [invoice_id, business_id],
    );
    invoice = invRes.rows[0];
    if (!invoice) throw new CreditNoteCreateError(404, 'INVOICE_NOT_FOUND', 'Linked invoice not found');
    if (invoice.status !== 'final') {
      throw new CreditNoteCreateError(400, 'INVOICE_NOT_FINAL', 'A credit note can only be issued against a final invoice');
    }
    if (invoice.customer_id && invoice.customer_id !== customer_id) {
      throw new CreditNoteCreateError(400, 'CUSTOMER_MISMATCH', 'The linked invoice belongs to a different customer');
    }
    if (invoice.place_of_supply_state_code) finalPosStateCode = invoice.place_of_supply_state_code;

    const { isCreditNoteTaxReductionTimeBarred, thirtyNovAfterFy } = await import('@/lib/gst/time-limits');
    if (
      invoice.invoice_date &&
      Number(invoice.tax_total) > 0 &&
      isCreditNoteTaxReductionTimeBarred(invoice.invoice_date, credit_note_date)
    ) {
      throw new CreditNoteCreateError(
        400,
        'CREDIT_NOTE_TIME_BARRED',
        `Invoice ${invoice.invoice_number}: GST can be reduced by a credit note only up to ${thirtyNovAfterFy(invoice.invoice_date)} (s.34(2) CGST Act). ` +
          'Record any commercial settlement as a financial adjustment outside GST.',
      );
    }

    const invItems = await client.query(
      `SELECT item_id, SUM(quantity)::numeric AS qty, MAX(tax_rate)::numeric AS tax_rate
         FROM invoice_items WHERE invoice_id = $1 AND item_id IS NOT NULL GROUP BY item_id`,
      [invoice_id],
    );
    const credited = await client.query(
      `SELECT cni.item_id, SUM(cni.qty)::numeric AS qty
         FROM credit_note_items cni
         JOIN credit_notes cn ON cn.id = cni.credit_note_id
        WHERE cn.invoice_id = $1 AND cn.business_id = $2 AND cn.status = 'active' AND cni.item_id IS NOT NULL
        GROUP BY cni.item_id`,
      [invoice_id, business_id],
    );
    const creditedQty = new Map(credited.rows.map((r) => [r.item_id, Number(r.qty) || 0]));
    for (const r of invItems.rows) {
      invoicedByItem.set(r.item_id, {
        qty: (Number(r.qty) || 0) - (creditedQty.get(r.item_id) || 0),
        taxRate: Number(r.tax_rate) || 0,
      });
    }
  }

  const intraState = (finalPosStateCode?.substring(0, 2) || '') === businessStateCode;
  const zeroRated = invoice ? isZeroRatedWithoutTax(invoice) : false;
  const lines = input.items.map((item) => {
    const qty = Number(item.qty ?? item.quantity) || 0;
    const unitPrice = Number(item.unit_price ?? item.price) || 0;
    const gross = qty * unitPrice;
    const discountPercent = Number(item.discount_percent) || 0;
    const discount = round2(
      discountPercent > 0 ? (gross * discountPercent) / 100 : Number(item.discount_amount ?? item.discount) || 0,
    );
    const linked = item.item_id ? invoicedByItem.get(item.item_id) : undefined;
    const taxRate = linked ? linked.taxRate : Number(item.tax_rate) || 0;
    const line = computeLineGst({ quantity: 1, unit_price: gross - discount, tax_rate: taxRate }, intraState, zeroRated);
    return { item, qty, unitPrice, discount, taxRate: zeroRated ? 0 : taxRate, ...line };
  });
  const { gstRateError } = await import('@/lib/gst/rates');
  const invDate: unknown = invoice?.invoice_date;
  const rateDate =
    invDate instanceof Date
      ? `${invDate.getFullYear()}-${String(invDate.getMonth() + 1).padStart(2, '0')}-${String(invDate.getDate()).padStart(2, '0')}`
      : String(invDate ?? credit_note_date).slice(0, 10);
  for (const l of lines) {
    const rateError = gstRateError(l.taxRate, rateDate);
    if (rateError) {
      throw new CreditNoteCreateError(400, 'INVALID_GST_RATE', `${l.item?.item_name || 'Line'}: ${rateError}`);
    }
  }

  if (lines.some((l) => l.qty <= 0 || l.taxable < 0)) {
    throw new CreditNoteCreateError(400, 'INVALID_LINE', 'Each credit note line needs a positive quantity and value');
  }

  if (invoice) {
    const requested = new Map<string, number>();
    for (const l of lines) {
      if (!l.item.item_id) continue;
      if (!invoicedByItem.has(l.item.item_id)) {
        throw new CreditNoteCreateError(
          400,
          'ITEM_NOT_ON_INVOICE',
          `"${l.item.item_name || l.item.description || l.item.item_id}" is not on invoice ${invoice.invoice_number}`,
        );
      }
      requested.set(l.item.item_id, (requested.get(l.item.item_id) || 0) + l.qty);
    }
    for (const [itemId, qty] of requested) {
      const available = invoicedByItem.get(itemId)!.qty;
      if (qty > available + 1e-9) {
        const name = lines.find((l) => l.item.item_id === itemId)?.item.item_name || itemId;
        throw new CreditNoteCreateError(
          400,
          'RETURN_EXCEEDS_INVOICED',
          `Return quantity for "${name}" (${qty}) exceeds the quantity still open on invoice ${invoice.invoice_number} (${Math.max(0, available)})`,
        );
      }
    }
  }

  const computedSubtotal = round2(lines.reduce((s, l) => s + l.taxable, 0));
  const computedDiscount = round2(lines.reduce((s, l) => s + l.discount, 0));
  const computedCgst = round2(lines.reduce((s, l) => s + l.cgst, 0));
  const computedSgst = round2(lines.reduce((s, l) => s + l.sgst, 0));
  const computedIgst = round2(lines.reduce((s, l) => s + l.igst, 0));
  const computedTax = round2(computedCgst + computedSgst + computedIgst);
  const computedRoundOff = round2(Number(input.roundOff) || 0);
  if (Math.abs(computedRoundOff) >= 1) {
    throw new CreditNoteCreateError(400, 'INVALID_ROUND_OFF', 'Round off must be less than ₹1');
  }
  const computedGrandTotal = round2(computedSubtotal + computedTax + computedRoundOff);

  if (invoice) {
    const prior = await client.query(
      `SELECT
         COALESCE((SELECT SUM(grand_total) FROM credit_notes
                    WHERE invoice_id = $1 AND business_id = $2 AND status = 'active'), 0) AS credited,
         COALESCE((SELECT SUM(grand_total) FROM debit_notes
                    WHERE invoice_id = $1 AND business_id = $2 AND status = 'active'), 0) AS debited`,
      [invoice_id, business_id],
    );
    const creditable = round2(
      Number(invoice.grand_total) + Number(prior.rows[0].debited) - Number(prior.rows[0].credited),
    );
    if (computedGrandTotal > creditable + 0.005) {
      throw new CreditNoteCreateError(
        400,
        'CREDIT_EXCEEDS_INVOICE',
        `Credit note total ₹${computedGrandTotal.toFixed(2)} exceeds the ₹${Math.max(0, creditable).toFixed(2)} still creditable on invoice ${invoice.invoice_number}`,
      );
    }
  }

  const creditNoteResult = await client.query(
    `
    INSERT INTO credit_notes (
      business_id, branch_id, customer_id, invoice_id, credit_note_number, credit_note_date,
      original_invoice_date, reason, place_of_supply_state_code,
      subtotal, discount_total, tax_total, cgst_total, sgst_total, igst_total,
      round_off, grand_total, refund_status, refund_mode, refund_date, refund_amount,
      notes, created_by
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)
    RETURNING *
  `,
    [
      business_id, finalBranchId, customer_id, invoice_id, credit_note_number, credit_note_date,
      input.originalInvoiceDate || (invoice ? invoice.invoice_date : null), input.reason ?? null, finalPosStateCode,
      computedSubtotal, computedDiscount, computedTax, computedCgst, computedSgst, computedIgst,
      computedRoundOff, computedGrandTotal, input.refundStatus ?? 'pending', input.refundMode ?? null,
      input.refundDate ?? null, input.refundAmount ?? null,
      input.notes ?? null, input.userId,
    ],
  );

  const creditNote = creditNoteResult.rows[0];

  const { isWarehouseModeEnabled } = await import('@/lib/warehouse-mode');
  const warehouseModeEnabled = await isWarehouseModeEnabled(business_id);

  // Insert credit note items and increase stock (goods coming back)
  for (let i = 0; i < lines.length; i++) {
    const { item, qty, unitPrice, discount, taxRate, taxAmount, lineTotal } = lines[i];

    await client.query(
      `
      INSERT INTO credit_note_items (
        credit_note_id, item_id, description, qty, unit, unit_price,
        discount, tax_rate, tax_amount, line_total, sort_order, hsn_sac, restocked
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
              COALESCE(NULLIF(TRIM($12::text), ''), (SELECT hsn_sac FROM items WHERE id = $2::uuid)), $13)
    `,
      [
        creditNote.id,
        item.item_id || null,
        item.description || item.item_name || 'Adjustment',
        qty,
        item.unit || 'PCS',
        unitPrice,
        discount,
        taxRate,
        taxAmount,
        lineTotal,
        i,
        item.hsn_sac || null,
        item.restock !== false,
      ],
    );

    let locationId = item.location_id || null;
    if (!locationId && invoice_id) {
      const invoiceItemRes = await client.query(
        `SELECT location_id FROM invoice_items WHERE invoice_id = $1 AND item_id = $2 LIMIT 1`,
        [invoice_id, item.item_id],
      );
      if (invoiceItemRes.rows.length > 0) {
        locationId = invoiceItemRes.rows[0].location_id;
      }
    }

    if (locationId) {
      await client.query(
        `UPDATE credit_note_items SET location_id = $1 WHERE credit_note_id = $2 AND item_id = $3`,
        [locationId, creditNote.id, item.item_id],
      );
    }

    // Increase stock (goods returned by customer), unless they came back damaged.
    if (item.item_id && item.restock !== false) {
      const itemTypeRes = await client.query('SELECT item_type FROM items WHERE id = $1', [item.item_id]);
      const itemType = itemTypeRes.rows[0]?.item_type || 'goods';

      if (itemType === 'goods') {
        const returnQty = parseFloat(String(item.qty || item.quantity || '0'));

        if (warehouseModeEnabled) {
          if (!locationId) {
            throw new CreditNoteCreateError(
              400,
              'WAREHOUSE_REQUIRED',
              `location_id (warehouse) is required for credit note line item "${item.item_name || item.item_id}".`,
            );
          }
          await client.query(`SELECT * FROM location_stock WHERE location_id = $1 AND item_id = $2 FOR UPDATE`, [
            locationId,
            item.item_id,
          ]);
          await client.query(
            `
            INSERT INTO location_stock (location_id, item_id, current_stock_qty)
            VALUES ($1, $2, $3)
            ON CONFLICT (location_id, item_id)
            DO UPDATE SET
              current_stock_qty = location_stock.current_stock_qty + $3,
              last_updated = CURRENT_TIMESTAMP
          `,
            [locationId, item.item_id, returnQty],
          );
        } else {
          await adjustBranchItemStock(client, business_id, finalBranchId, item.item_id, returnQty);
          await refreshItemGlobalStockFromBranches(client, business_id, item.item_id);
        }

        await client.query(
          `
          INSERT INTO stock_movements (
            business_id, item_id, location_id, type, quantity, reference_type, reference_id, notes
          )
          VALUES ($1, $2, $3, 'in', $4, 'credit_note', $5, $6)
        `,
          [business_id, item.item_id, locationId, returnQty, creditNote.id, `Sales Return: ${credit_note_number}`],
        );
      }
    }
  }

  // Customer owes less now.
  await client.query(
    `UPDATE customers
        SET current_balance = current_balance - $1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2 AND business_id = $3`,
    [computedGrandTotal, customer_id, business_id],
  );

  if (invoice_id) {
    await recomputeInvoiceBalance(client, invoice_id, business_id);
  }
  await refreshCreditNoteRefundStatus(client, business_id, creditNote.id);

  // Cost of goods coming back into stock; damaged lines are written off so their cost stays in COGS.
  let totalCogsAmount = 0;
  for (const { item } of lines) {
    if (item.item_id && item.restock !== false) {
      const itemData = await client.query('SELECT purchase_price, item_type FROM items WHERE id = $1', [item.item_id]);
      if (itemData.rows[0]?.item_type === 'goods' && itemData.rows[0]?.purchase_price) {
        const itemCost = Number(itemData.rows[0].purchase_price) || 0;
        const itemQuantity = Number(item.qty || item.quantity) || 0;
        totalCogsAmount += itemCost * itemQuantity;
      }
    }
  }

  // Ledger posting runs inside the transaction so the deferred balance trigger sees every line.
  await createCreditNoteLedgerEntries({
    businessId: business_id,
    creditNoteId: creditNote.id,
    creditNoteNumber: credit_note_number,
    creditNoteDate: credit_note_date,
    grandTotal: computedGrandTotal,
    customerId: customer_id,
    cogsAmount: totalCogsAmount,
    branchId: finalBranchId,
    taxableValue: computedSubtotal,
    cgstTotal: computedCgst,
    sgstTotal: computedSgst,
    igstTotal: computedIgst,
    poolClient: client,
  });

  return creditNote;
}
