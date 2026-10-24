import type { PoolClient } from 'pg';
import { insertVoucherLines, round2 } from './voucher-posting';
import {
  advanceAdjustmentLines,
  advanceReceiptLines,
  advanceRefundLines,
  allocateFyVoucherNumber,
  loadAdvanceAccounts,
  proportionalReversal,
  splitAdvanceGst,
  type AdvanceType,
  type SupplyType,
  type TaxSplit,
} from './advances';
import { listCashBankAccounts } from './contra';
import { recomputeInvoiceBalance } from '@/lib/invoices/invoice-balance';
import { purchaseOutstanding, recomputePurchaseBalance } from '@/lib/purchases/purchase-balance';
import { isAllowedGstRate } from '@/lib/gst/rates';

export class AdvanceError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

const stateOf = (gstin: string | null | undefined) =>
  gstin && /^\d{2}/.test(String(gstin).trim()) ? String(gstin).trim().slice(0, 2) : null;

async function requireCashBank(client: PoolClient, businessId: string, accountId: string) {
  const ok = (await listCashBankAccounts(client, businessId)).some((a) => a.id === accountId);
  if (!ok) throw new AdvanceError(400, 'NOT_CASH_OR_BANK', 'Choose a cash or bank account for the money movement');
}

export async function createAdvance(
  client: PoolClient,
  p: {
    businessId: string;
    branchId: string | null;
    userId: string;
    type: AdvanceType;
    partyId: string;
    amount: number;
    date: string;
    supplyType: SupplyType;
    taxRate: number;
    cessRate?: number;
    placeOfSupply?: string | null;
    paymentAccountId: string;
    reference?: string | null;
    notes?: string | null;
  }
): Promise<{ id: string; voucher_number: string; split: TaxSplit }> {
  const amount = round2(p.amount);
  if (!(amount > 0)) throw new AdvanceError(400, 'INVALID_AMOUNT', 'Amount must be greater than zero');
  if (p.type === 'received' && p.supplyType === 'services' && !isAllowedGstRate(p.taxRate, p.date)) {
    throw new AdvanceError(400, 'INVALID_GST_RATE', `GST rate ${p.taxRate}% is not a notified rate`);
  }
  await requireCashBank(client, p.businessId, p.paymentAccountId);

  const party = (
    await client.query(
      p.type === 'received'
        ? `SELECT id, name, gstin, state_code FROM customers WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL`
        : `SELECT id, name, gstin, state_code FROM suppliers WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL`,
      [p.partyId, p.businessId]
    )
  ).rows[0];
  if (!party) throw new AdvanceError(404, 'PARTY_NOT_FOUND', p.type === 'received' ? 'Customer not found' : 'Supplier not found');

  const biz = (await client.query(`SELECT gstin, state_code FROM businesses WHERE id = $1`, [p.businessId])).rows[0];
  const selfState = stateOf(biz?.gstin) || (biz?.state_code ? String(biz.state_code).padStart(2, '0') : null);
  const pos =
    (p.placeOfSupply && /^\d{2}$/.test(p.placeOfSupply) ? p.placeOfSupply : null) ||
    stateOf(party.gstin) ||
    (party.state_code ? String(party.state_code).padStart(2, '0') : null) ||
    selfState;
  const intraState = !!selfState && pos === selfState;

  const split = splitAdvanceGst({
    amount,
    supplyType: p.supplyType,
    taxRate: p.taxRate,
    cessRate: p.cessRate,
    intraState,
    type: p.type,
  });
  const accounts = await loadAdvanceAccounts(client, p.businessId);
  const voucherNumber = await allocateFyVoucherNumber(client, {
    businessId: p.businessId,
    prefix: p.type === 'received' ? 'RV' : 'ADVP',
    date: p.date,
    table: 'advance_payments',
  });
  const voucherId = (await client.query<{ id: string }>('SELECT uuid_generate_v4() AS id')).rows[0].id;
  const label = `${p.type === 'received' ? 'Advance received from' : 'Advance paid to'} ${party.name} (${voucherNumber})`;

  await insertVoucherLines(client, {
    businessId: p.businessId,
    branchId: p.branchId,
    voucherId,
    voucherType: 'advance_receipt',
    entryDate: p.date,
    reference: voucherNumber,
    lines: advanceReceiptLines({ type: p.type, amount, split, paymentAccountId: p.paymentAccountId, accounts, label }),
  });

  const ins = await client.query<{ id: string }>(
    `INSERT INTO advance_payments (
       business_id, customer_id, supplier_id, type, amount, cgst, sgst, igst, cess, taxable_value, tax_rate,
       supply_type, payment_date, place_of_supply_state_code, notes, created_by, payment_account_id,
       voucher_id, voucher_number, reference_number, branch_id, is_adjusted, status
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,false,'open')
     RETURNING id`,
    [
      p.businessId,
      p.type === 'received' ? p.partyId : null,
      p.type === 'paid' ? p.partyId : null,
      p.type,
      amount,
      split.cgst,
      split.sgst,
      split.igst,
      split.cess,
      split.taxable,
      p.supplyType === 'services' ? p.taxRate : 0,
      p.supplyType,
      p.date,
      pos,
      p.notes || null,
      p.userId,
      p.paymentAccountId,
      voucherId,
      voucherNumber,
      p.reference ? String(p.reference).slice(0, 100) : null,
      p.branchId,
    ]
  );
  return { id: ins.rows[0].id, voucher_number: voucherNumber, split };
}

async function lockAdvance(client: PoolClient, businessId: string, advanceId: string) {
  const adv = (
    await client.query(
      `SELECT * FROM advance_payments WHERE id = $1 AND business_id = $2 FOR UPDATE`,
      [advanceId, businessId]
    )
  ).rows[0];
  if (!adv) throw new AdvanceError(404, 'ADVANCE_NOT_FOUND', 'Advance not found');
  if (adv.status === 'cancelled') throw new AdvanceError(400, 'ADVANCE_CANCELLED', 'Advance is cancelled');
  const prior = (
    await client.query(
      `SELECT COALESCE(SUM(amount),0) AS amount, COALESCE(SUM(taxable_value),0) AS taxable,
              COALESCE(SUM(cgst),0) AS cgst, COALESCE(SUM(sgst),0) AS sgst,
              COALESCE(SUM(igst),0) AS igst, COALESCE(SUM(cess),0) AS cess
         FROM advance_adjustments WHERE advance_id = $1 AND business_id = $2 AND reversed_at IS NULL`,
      [advanceId, businessId]
    )
  ).rows[0];
  const amount = Number(adv.amount);
  const consumed = round2(Number(prior.amount));
  return {
    adv,
    amount,
    consumed,
    remaining: round2(amount - consumed),
    split: {
      taxable: Number(adv.taxable_value ?? amount),
      cgst: Number(adv.cgst || 0),
      sgst: Number(adv.sgst || 0),
      igst: Number(adv.igst || 0),
      cess: Number(adv.cess || 0),
    } as TaxSplit,
    reversedBefore: {
      taxable: Number(prior.taxable),
      cgst: Number(prior.cgst),
      sgst: Number(prior.sgst),
      igst: Number(prior.igst),
      cess: Number(prior.cess),
    } as TaxSplit,
  };
}

async function setAdvanceStatus(client: PoolClient, businessId: string, advanceId: string) {
  await client.query(
    `UPDATE advance_payments a SET
       adjusted_amount = s.adjusted,
       refunded_amount = s.refunded,
       status = CASE
         WHEN s.adjusted + s.refunded >= a.amount - 0.005 THEN CASE WHEN s.adjusted > 0 THEN 'adjusted' ELSE 'refunded' END
         WHEN s.adjusted + s.refunded > 0 THEN 'partially_adjusted'
         ELSE 'open' END,
       adjustment_date = s.last_date
     FROM (
       SELECT COALESCE(SUM(amount) FILTER (WHERE kind <> 'refund'), 0) AS adjusted,
              COALESCE(SUM(amount) FILTER (WHERE kind = 'refund'), 0) AS refunded,
              MAX(adjustment_date) AS last_date
         FROM advance_adjustments WHERE advance_id = $1 AND business_id = $2 AND reversed_at IS NULL
     ) s
     WHERE a.id = $1 AND a.business_id = $2`,
    [advanceId, businessId]
  );
}

async function insertAdjustmentRow(
  client: PoolClient,
  p: {
    businessId: string;
    advanceId: string;
    kind: 'invoice' | 'purchase' | 'refund';
    invoiceId?: string | null;
    purchaseId?: string | null;
    date: string;
    amount: number;
    reversal: TaxSplit;
    voucherId: string;
    voucherNumber: string;
    paymentAccountId?: string | null;
    notes?: string | null;
    userId: string;
  }
) {
  const res = await client.query<{ id: string }>(
    `INSERT INTO advance_adjustments (
       business_id, advance_id, kind, invoice_id, purchase_id, adjustment_date, amount,
       taxable_value, cgst, sgst, igst, cess, voucher_id, voucher_number, payment_account_id, notes, created_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING id`,
    [
      p.businessId,
      p.advanceId,
      p.kind,
      p.invoiceId || null,
      p.purchaseId || null,
      p.date,
      p.amount,
      p.reversal.taxable,
      p.reversal.cgst,
      p.reversal.sgst,
      p.reversal.igst,
      p.reversal.cess,
      p.voucherId,
      p.voucherNumber,
      p.paymentAccountId || null,
      p.notes || null,
      p.userId,
    ]
  );
  return res.rows[0].id;
}

export async function adjustAdvance(
  client: PoolClient,
  p: {
    businessId: string;
    branchId: string | null;
    userId: string;
    advanceId: string;
    invoiceId?: string | null;
    purchaseId?: string | null;
    amount: number;
    date: string;
  }
): Promise<{ id: string; voucher_number: string; reversal: TaxSplit }> {
  const amount = round2(p.amount);
  if (!(amount > 0)) throw new AdvanceError(400, 'INVALID_AMOUNT', 'Amount must be greater than zero');
  const st = await lockAdvance(client, p.businessId, p.advanceId);
  const { adv } = st;
  if (amount > st.remaining + 0.005) {
    throw new AdvanceError(400, 'EXCEEDS_ADVANCE', `Only ₹${st.remaining.toFixed(2)} of this advance is unadjusted`);
  }
  if (p.date < String(adv.payment_date instanceof Date ? adv.payment_date.toISOString() : adv.payment_date).slice(0, 10)) {
    throw new AdvanceError(400, 'DATE_BEFORE_ADVANCE', 'Adjustment date cannot be before the advance date');
  }

  let docNumber = '';
  if (adv.type === 'received') {
    if (!p.invoiceId) throw new AdvanceError(400, 'INVOICE_REQUIRED', 'invoice_id is required');
    const inv = (
      await client.query(
        `SELECT id, invoice_number, customer_id, status, document_type FROM invoices
          WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL FOR UPDATE`,
        [p.invoiceId, p.businessId]
      )
    ).rows[0];
    if (!inv) throw new AdvanceError(404, 'INVOICE_NOT_FOUND', 'Invoice not found');
    if (inv.customer_id !== adv.customer_id) {
      throw new AdvanceError(400, 'PARTY_MISMATCH', 'Invoice belongs to a different customer');
    }
    if (inv.status !== 'final' || inv.document_type === 'proforma_invoice') {
      throw new AdvanceError(400, 'INVOICE_NOT_FINAL', 'Advances can only be adjusted against a final tax invoice');
    }
    const bal = await recomputeInvoiceBalance(client, inv.id, p.businessId);
    if (amount > (bal?.balance_amount ?? 0) + 0.005) {
      throw new AdvanceError(400, 'EXCEEDS_INVOICE_BALANCE', `Invoice balance is ₹${(bal?.balance_amount ?? 0).toFixed(2)}`);
    }
    docNumber = inv.invoice_number;
  } else {
    if (!p.purchaseId) throw new AdvanceError(400, 'PURCHASE_REQUIRED', 'purchase_id is required');
    const pur = (
      await client.query(
        `SELECT id, bill_number, supplier_id, status, grand_total, tax_total, is_reverse_charge, paid_amount,
                COALESCE(tds_deducted, 0) AS tds_deducted, COALESCE(advance_adjusted, 0) AS advance_adjusted
           FROM purchases WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL FOR UPDATE`,
        [p.purchaseId, p.businessId]
      )
    ).rows[0];
    if (!pur) throw new AdvanceError(404, 'PURCHASE_NOT_FOUND', 'Purchase not found');
    if (pur.supplier_id !== adv.supplier_id) {
      throw new AdvanceError(400, 'PARTY_MISMATCH', 'Purchase belongs to a different supplier');
    }
    if (pur.status === 'cancelled') throw new AdvanceError(400, 'PURCHASE_CANCELLED', 'Purchase is cancelled');
    const outstanding = purchaseOutstanding(pur);
    if (amount > outstanding + 0.005) {
      throw new AdvanceError(400, 'EXCEEDS_PURCHASE_BALANCE', `Bill balance is ₹${outstanding.toFixed(2)}`);
    }
    docNumber = pur.bill_number || 'bill';
  }

  const reversal =
    adv.type === 'received'
      ? proportionalReversal({
          advanceAmount: st.amount,
          advanceSplit: st.split,
          consumedBefore: st.consumed,
          reversedBefore: st.reversedBefore,
          portion: amount,
        })
      : { taxable: amount, cgst: 0, sgst: 0, igst: 0, cess: 0 };

  const accounts = await loadAdvanceAccounts(client, p.businessId);
  const voucherNumber = await allocateFyVoucherNumber(client, {
    businessId: p.businessId,
    prefix: 'ADJ',
    date: p.date,
    table: 'advance_adjustments',
  });
  const voucherId = (await client.query<{ id: string }>('SELECT uuid_generate_v4() AS id')).rows[0].id;
  await insertVoucherLines(client, {
    businessId: p.businessId,
    branchId: p.branchId,
    voucherId,
    voucherType: 'advance_adjustment',
    entryDate: p.date,
    reference: docNumber,
    lines: advanceAdjustmentLines({
      type: adv.type,
      amount,
      reversal,
      accounts,
      label: `Advance ${adv.voucher_number || ''} adjusted against ${docNumber}`.replace(/\s+/g, ' '),
    }),
  });

  const id = await insertAdjustmentRow(client, {
    businessId: p.businessId,
    advanceId: p.advanceId,
    kind: adv.type === 'received' ? 'invoice' : 'purchase',
    invoiceId: adv.type === 'received' ? p.invoiceId : null,
    purchaseId: adv.type === 'paid' ? p.purchaseId : null,
    date: p.date,
    amount,
    reversal,
    voucherId,
    voucherNumber,
    userId: p.userId,
  });

  if (adv.type === 'received') {
    await client.query(
      `UPDATE invoices SET advance_adjusted = COALESCE(advance_adjusted, 0) + $1 WHERE id = $2 AND business_id = $3`,
      [amount, p.invoiceId, p.businessId]
    );
    await recomputeInvoiceBalance(client, p.invoiceId!, p.businessId);
    await client.query(
      `UPDATE customers SET current_balance = current_balance - $1, updated_at = CURRENT_TIMESTAMP
        WHERE id = $2 AND business_id = $3`,
      [amount, adv.customer_id, p.businessId]
    );
  } else {
    await client.query(
      `UPDATE purchases SET advance_adjusted = COALESCE(advance_adjusted, 0) + $1 WHERE id = $2 AND business_id = $3`,
      [amount, p.purchaseId, p.businessId]
    );
    await recomputePurchaseBalance(client, p.purchaseId!, p.businessId);
    await client.query(
      `UPDATE suppliers SET current_balance = current_balance - $1, updated_at = CURRENT_TIMESTAMP
        WHERE id = $2 AND business_id = $3`,
      [amount, adv.supplier_id, p.businessId]
    );
  }
  await setAdvanceStatus(client, p.businessId, p.advanceId);
  return { id, voucher_number: voucherNumber, reversal };
}

/**
 * Releases every live advance adjustment against a cancelled invoice or purchase: reverses
 * the adjustment voucher, marks the adjustment reversed, gives the amount back to the
 * advance and takes it off the document's advance_adjusted. Party balances are left to the
 * caller, which knows how the document's own cancellation moves them.
 */
export async function releaseDocumentAdvances(
  client: PoolClient,
  p: {
    businessId: string;
    userId: string | null;
    invoiceId?: string | null;
    purchaseId?: string | null;
    reason: string;
  }
): Promise<{ released: number; adjustments: number }> {
  if (!p.invoiceId === !p.purchaseId) throw new Error('releaseDocumentAdvances needs exactly one of invoiceId / purchaseId');
  const rows = (
    await client.query<{ id: string; advance_id: string; amount: string; voucher_id: string | null }>(
      `SELECT id, advance_id, amount, voucher_id FROM advance_adjustments
        WHERE business_id = $1 AND reversed_at IS NULL AND kind <> 'refund'
          AND ${p.invoiceId ? 'invoice_id' : 'purchase_id'} = $2
        ORDER BY created_at, id
        FOR UPDATE`,
      [p.businessId, p.invoiceId || p.purchaseId]
    )
  ).rows;
  if (rows.length === 0) return { released: 0, adjustments: 0 };

  const { reverseVoucherLedgerEntries } = await import('@/lib/ledger-reversal');
  let released = 0;
  for (const r of rows) {
    await client.query(`SELECT 1 FROM advance_payments WHERE id = $1 AND business_id = $2 FOR UPDATE`, [
      r.advance_id,
      p.businessId,
    ]);
    if (r.voucher_id) {
      await reverseVoucherLedgerEntries(client, {
        businessId: p.businessId,
        voucherType: 'advance_adjustment',
        voucherId: r.voucher_id,
        reason: p.reason,
        actorId: p.userId,
      });
    }
    await client.query(
      `UPDATE advance_adjustments SET reversed_at = CURRENT_TIMESTAMP, reversed_by = $3, reversal_reason = $4
        WHERE id = $1 AND business_id = $2`,
      [r.id, p.businessId, p.userId, p.reason.slice(0, 500)]
    );
    await setAdvanceStatus(client, p.businessId, r.advance_id);
    released = round2(released + Number(r.amount));
  }

  const docCol = p.invoiceId ? 'invoice_id' : 'purchase_id';
  await client.query(
    `UPDATE ${p.invoiceId ? 'invoices' : 'purchases'} d
        SET advance_adjusted = (
          SELECT COALESCE(SUM(aa.amount), 0) FROM advance_adjustments aa
           WHERE aa.business_id = d.business_id AND aa.${docCol} = d.id
             AND aa.reversed_at IS NULL AND aa.kind <> 'refund')
      WHERE d.id = $1 AND d.business_id = $2`,
    [p.invoiceId || p.purchaseId, p.businessId]
  );
  return { released, adjustments: rows.length };
}

export async function refundAdvance(
  client: PoolClient,
  p: {
    businessId: string;
    branchId: string | null;
    userId: string;
    advanceId: string;
    amount: number;
    date: string;
    paymentAccountId: string;
    notes?: string | null;
  }
): Promise<{ id: string; voucher_number: string; reversal: TaxSplit }> {
  const amount = round2(p.amount);
  if (!(amount > 0)) throw new AdvanceError(400, 'INVALID_AMOUNT', 'Amount must be greater than zero');
  await requireCashBank(client, p.businessId, p.paymentAccountId);
  const st = await lockAdvance(client, p.businessId, p.advanceId);
  const { adv } = st;
  if (amount > st.remaining + 0.005) {
    throw new AdvanceError(400, 'EXCEEDS_ADVANCE', `Only ₹${st.remaining.toFixed(2)} of this advance is unadjusted`);
  }
  if (p.date < String(adv.payment_date instanceof Date ? adv.payment_date.toISOString() : adv.payment_date).slice(0, 10)) {
    throw new AdvanceError(400, 'DATE_BEFORE_ADVANCE', 'Refund date cannot be before the advance date');
  }
  const reversal =
    adv.type === 'received'
      ? proportionalReversal({
          advanceAmount: st.amount,
          advanceSplit: st.split,
          consumedBefore: st.consumed,
          reversedBefore: st.reversedBefore,
          portion: amount,
        })
      : { taxable: amount, cgst: 0, sgst: 0, igst: 0, cess: 0 };

  const accounts = await loadAdvanceAccounts(client, p.businessId);
  const voucherNumber = await allocateFyVoucherNumber(client, {
    businessId: p.businessId,
    prefix: adv.type === 'received' ? 'RFV' : 'ADVR',
    date: p.date,
    table: 'advance_adjustments',
  });
  const voucherId = (await client.query<{ id: string }>('SELECT uuid_generate_v4() AS id')).rows[0].id;
  await insertVoucherLines(client, {
    businessId: p.businessId,
    branchId: p.branchId,
    voucherId,
    voucherType: 'advance_refund',
    entryDate: p.date,
    reference: voucherNumber,
    lines: advanceRefundLines({
      type: adv.type,
      amount,
      reversal,
      paymentAccountId: p.paymentAccountId,
      accounts,
      label: `Refund of advance ${adv.voucher_number || ''} (${voucherNumber})`.replace(/\s+/g, ' '),
    }),
  });
  const id = await insertAdjustmentRow(client, {
    businessId: p.businessId,
    advanceId: p.advanceId,
    kind: 'refund',
    date: p.date,
    amount,
    reversal,
    voucherId,
    voucherNumber,
    paymentAccountId: p.paymentAccountId,
    notes: p.notes,
    userId: p.userId,
  });
  await setAdvanceStatus(client, p.businessId, p.advanceId);
  return { id, voucher_number: voucherNumber, reversal };
}
