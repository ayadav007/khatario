/**
 * Real-PostgreSQL tests for Phase 2 (reversal-based corrections, migration 324).
 * Runs only when PHASE2_TEST_DATABASE_URL points at a disposable database that has the
 * application schema plus migrations 323 and 324. Each run creates its own business and
 * purges it (tenant_purge) at the end.
 */
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import type { Pool, PoolClient } from 'pg';

const url = process.env.PHASE2_TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
const d = url ? describe : describe.skip;

import { getPool, closePool } from '@/lib/db';
import { createInvoiceLedgerEntries, createPaymentLedgerEntries, createPurchaseLedgerEntries } from '@/lib/ledger-utils';
import { adjustBranchItemStock, getBranchItemQuantity, refreshItemGlobalStockFromBranches } from '@/lib/branch-stock';
import { cancelFinalPurchase } from '@/lib/purchases/cancel-purchase';
import { createAdvance, adjustAdvance } from '@/lib/accounting/advance-service';
import { reverseInvoiceAccountingOnCancel } from '@/lib/invoices/cancel-invoice-accounting';
import { reverseInvoicePostingForRepost, reverseReplacedInvoicePayments } from '@/lib/invoices/invoice-edit-postings';
import { postExpenseVoucher } from '@/lib/accounting/expense-posting';
import { repostExpense, deleteExpenseByReversal, type ExpenseRow } from '@/lib/accounting/expense-corrections';
import { repostJournal, deleteJournalByReversal } from '@/lib/accounting/journal-corrections';
import { reverseVoucherLedgerEntries } from '@/lib/ledger-reversal';
import { withLedgerDelete } from '@/lib/accounting/ledger-delete-guard';
import { periodGuardResponse } from '@/lib/http/period-guards';
import { assertGstPeriodNotFiledForDocumentDate } from '@/lib/gst/gst-filing';

const migration324 = fs.readFileSync(
  path.join(__dirname, '../../database/migrations/324_ledger_reversal_links.sql'),
  'utf8'
);
const migration325 = fs.readFileSync(
  path.join(__dirname, '../../database/migrations/325_tds_transaction_status.sql'),
  'utf8'
);

type Line = { id: string; code: string; dr: number; cr: number; d: string; reversed: boolean; is_reversal: boolean };

const r2 = (n: number) => Math.round(n * 100) / 100;

d('Phase 2 reversal-based corrections (real DB)', () => {
  jest.setTimeout(60000);

  let pool: Pool;
  const B = randomUUID();
  const BR = randomUUID();
  const U = randomUUID();
  const CUST = randomUUID();
  const SUPP = randomUUID();
  const ITEM = randomUUID();
  const tag = B.slice(0, 8);

  async function tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      const out = await fn(c);
      await c.query('COMMIT');
      return out;
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      c.release();
    }
  }

  async function errorOf(p: Promise<unknown>): Promise<{ message: string; code?: string; status?: number } | null> {
    try {
      await p;
      return null;
    } catch (e) {
      const err = e as { message: string; code?: string; status?: number };
      return { message: err.message, code: err.code, status: err.status };
    }
  }

  const accId = async (code: string) =>
    (await pool.query<{ id: string }>(`SELECT id FROM accounts WHERE business_id = $1 AND account_code = $2`, [B, code]))
      .rows[0].id;

  async function lines(type: string, id: string): Promise<Line[]> {
    return (
      await pool.query<Line>(
        `SELECT l.id, a.account_code AS code, l.debit::float8 AS dr, l.credit::float8 AS cr, l.entry_date::text AS d,
                EXISTS (SELECT 1 FROM ledger_entry_reversals r WHERE r.original_line_id = l.id) AS reversed,
                EXISTS (SELECT 1 FROM ledger_entry_reversals r WHERE r.reversal_line_id = l.id) AS is_reversal
           FROM ledger_entry_lines l JOIN accounts a ON a.id = l.account_id
          WHERE l.business_id = $1 AND l.voucher_type = $2 AND l.voucher_id = $3
          ORDER BY l.created_at, l.id`,
        [B, type, id]
      )
    ).rows;
  }

  const net = (rows: Line[]) => {
    const m: Record<string, number> = {};
    for (const r of rows) m[r.code] = r2((m[r.code] || 0) + r.dr - r.cr);
    for (const k of Object.keys(m)) if (m[k] === 0) delete m[k];
    return m;
  };
  const active = (rows: Line[]) => rows.filter((r) => !r.reversed && !r.is_reversal);

  /** Voucher invariants: balanced overall, every reversal linked 1:1 to an original, active lines balanced. */
  function expectVoucherConsistent(rows: Line[]) {
    const dr = r2(rows.reduce((s, r) => s + r.dr, 0));
    const cr = r2(rows.reduce((s, r) => s + r.cr, 0));
    expect(dr).toBe(cr);
    const act = active(rows);
    expect(r2(act.reduce((s, r) => s + r.dr, 0))).toBe(r2(act.reduce((s, r) => s + r.cr, 0)));
    expect(rows.filter((r) => r.reversed).length).toBe(rows.filter((r) => r.is_reversal).length);
  }

  async function expectBusinessBalanced() {
    const t = (
      await pool.query<{ dr: string; cr: string }>(
        `SELECT COALESCE(SUM(debit), 0) AS dr, COALESCE(SUM(credit), 0) AS cr FROM ledger_entry_lines WHERE business_id = $1`,
        [B]
      )
    ).rows[0];
    expect(Number(t.dr)).toBeCloseTo(Number(t.cr), 2);
    const orphans = await pool.query(
      `SELECT 1 FROM ledger_entry_reversals r
         LEFT JOIN ledger_entry_lines o ON o.id = r.original_line_id
         LEFT JOIN ledger_entry_lines v ON v.id = r.reversal_line_id
        WHERE r.business_id = $1 AND (o.id IS NULL OR v.id IS NULL)`,
      [B]
    );
    expect(orphans.rows.length).toBe(0);
  }

  const balanceOf = async (table: 'customers' | 'suppliers', id: string) =>
    Number((await pool.query(`SELECT current_balance FROM ${table} WHERE id = $1`, [id])).rows[0].current_balance);
  const stock = () => getBranchItemQuantity(pool as unknown as PoolClient, B, BR, ITEM);

  async function makePurchase(o: { qty: number; price: number; gst: boolean; date: string }) {
    const id = randomUUID();
    const taxable = r2(o.qty * o.price);
    const half = o.gst ? r2(taxable * 0.09) : 0;
    const grand = r2(taxable + 2 * half);
    const billNo = `PB-${tag}-${id.slice(0, 4)}`;
    await tx(async (c) => {
      await c.query(
        `INSERT INTO purchases (id, business_id, supplier_id, bill_number, bill_date, status, place_of_supply_state_code,
            is_reverse_charge, itc_eligible, subtotal, tax_total, cgst_total, sgst_total, igst_total, grand_total,
            paid_amount, balance_amount, payment_status, branch_id)
         VALUES ($1, $2, $3, $4, $5, 'final', '27', false, true, $6, $7, $8, $8, 0, $9, 0, $9, 'unpaid', $10)`,
        [id, B, SUPP, billNo, o.date, taxable, 2 * half, half, grand, BR]
      );
      await c.query(
        `INSERT INTO purchase_items (purchase_id, item_id, item_name, quantity, unit_price, taxable_value, tax_rate,
            tax_amount, cgst_amount, sgst_amount, line_total)
         VALUES ($1, $2, 'Widget', $3, $4, $5, $6, $7, $8, $8, $9)`,
        [id, ITEM, o.qty, o.price, taxable, o.gst ? 18 : 0, 2 * half, half, grand]
      );
      await adjustBranchItemStock(c, B, BR, ITEM, o.qty);
      await refreshItemGlobalStockFromBranches(c, B, ITEM);
      await c.query(
        `INSERT INTO stock_movements (business_id, item_id, type, quantity, reference_type, reference_id, unit_cost, created_by)
         VALUES ($1, $2, 'in', $3, 'purchase', $4, $5, $6)`,
        [B, ITEM, o.qty, id, o.price, U]
      );
      await createPurchaseLedgerEntries({
        businessId: B,
        purchaseId: id,
        purchaseNumber: billNo,
        purchaseDate: o.date,
        grandTotal: grand,
        supplierId: SUPP,
        isCashPurchase: false,
        branchId: BR,
        poolClient: c,
        taxableValue: taxable,
        cgstTotal: half,
        sgstTotal: half,
        itcEligible: true,
        itcClaimDate: o.date,
      });
      await c.query(`UPDATE suppliers SET current_balance = current_balance + $1 WHERE id = $2`, [grand, SUPP]);
    });
    return { id, grand };
  }

  async function payPurchase(purchaseId: string, amount: number, date: string) {
    return tx(async (c) => {
      const pid = (
        await c.query<{ id: string }>(
          `INSERT INTO payments (business_id, branch_id, type, supplier_id, reference_type, reference_id, amount, payment_mode, payment_date)
           VALUES ($1, $2, 'payable', $3, 'purchase', $4, $5, 'cash', $6) RETURNING id`,
          [B, BR, SUPP, purchaseId, amount, date]
        )
      ).rows[0].id;
      await c.query(
        `UPDATE purchases SET paid_amount = paid_amount + $1, balance_amount = balance_amount - $1 WHERE id = $2`,
        [amount, purchaseId]
      );
      await c.query(`UPDATE suppliers SET current_balance = current_balance - $1 WHERE id = $2`, [amount, SUPP]);
      await createPaymentLedgerEntries({
        businessId: B,
        paymentId: pid,
        paymentDate: date,
        amount,
        type: 'payable',
        supplierId: SUPP,
        paymentMode: 'cash',
        branchId: BR,
        poolClient: c,
      });
      return pid;
    });
  }

  async function makeInvoice(o: { taxable: number; gst: boolean; date: string }) {
    const id = randomUUID();
    const half = o.gst ? r2(o.taxable * 0.09) : 0;
    const grand = r2(o.taxable + 2 * half);
    const no = `INV-${tag}-${id.slice(0, 4)}`;
    await tx(async (c) => {
      await c.query(
        `INSERT INTO invoices (id, business_id, customer_id, invoice_number, invoice_date, status, document_type,
            place_of_supply_state_code, subtotal, tax_total, cgst_total, sgst_total, igst_total, grand_total,
            paid_amount, balance_amount, payment_status, branch_id)
         VALUES ($1, $2, $3, $4, $5, 'final', 'tax_invoice', '27', $6, $7, $8, $8, 0, $9, 0, $9, 'unpaid', $10)`,
        [id, B, CUST, no, o.date, o.taxable, 2 * half, half, grand, BR]
      );
      await createInvoiceLedgerEntries({
        businessId: B,
        invoiceId: id,
        invoiceNumber: no,
        invoiceDate: o.date,
        grandTotal: grand,
        customerId: CUST,
        isCashSale: false,
        branchId: BR,
        taxableValue: o.taxable,
        cgstTotal: half,
        sgstTotal: half,
        poolClient: c,
      });
      await c.query(`UPDATE customers SET current_balance = current_balance + $1 WHERE id = $2`, [grand, CUST]);
    });
    return { id, no, grand };
  }

  async function makeExpense(amount: number, date: string): Promise<ExpenseRow> {
    const id = randomUUID();
    return tx(async (c) => {
      const row = (
        await c.query<ExpenseRow>(
          `INSERT INTO expenses (id, business_id, branch_id, amount, description, expense_date, payment_mode, created_by)
           VALUES ($1, $2, $3, $4, 'Office rent', $5, 'cash', $6)
           RETURNING id, business_id, branch_id, category_id, amount, description, expense_date::text, payment_mode,
                     reference_number, cgst_amount, sgst_amount, igst_amount, itc_eligible, is_reverse_charge,
                     tds_section, tds_amount, supplier_id`,
          [id, B, BR, amount, date, U]
        )
      ).rows[0];
      await postExpenseVoucher(c, {
        businessId: B,
        branchId: BR,
        expenseId: id,
        expenseDate: date,
        expenseAccountId: null,
        paymentMode: 'cash',
        description: 'Office rent',
        reference: null,
        amount,
        cgst: 0,
        sgst: 0,
        igst: 0,
        itcEligible: false,
        isReverseCharge: false,
        tdsAmount: 0,
      });
      return row;
    });
  }

  const loadExpense = async (id: string) =>
    (
      await pool.query<ExpenseRow & { deleted_at: Date | null }>(
        `SELECT id, business_id, branch_id, category_id, amount, description, expense_date::text, payment_mode,
                reference_number, cgst_amount, sgst_amount, igst_amount, itc_eligible, is_reverse_charge,
                tds_section, tds_amount, supplier_id, deleted_at
           FROM expenses WHERE id = $1`,
        [id]
      )
    ).rows[0];

  const noTax = { itcEligible: false, isReverseCharge: false, tdsSection: null, tdsAmount: 0 };
  const editExpense = (old: ExpenseRow, amount: number) =>
    tx((c) =>
      repostExpense(c, {
        businessId: B,
        userId: U,
        old,
        next: { ...old, amount: String(amount) },
        tax: noTax,
        expenseAccountId: null,
      })
    );

  beforeAll(async () => {
    pool = getPool();
    // Re-applying 324 must be a no-op on an already migrated database.
    await tx((c) => c.query(migration324));
    await tx((c) => c.query(migration325));

    await pool.query(
      `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type)
       VALUES ($1, $2, '27AAAPA1234A1Z5', '27', 'regular')`,
      [B, `Phase2 ${tag}`]
    );
    await pool.query(
      `INSERT INTO branches (id, business_id, name, state_code, is_primary, is_default, is_active)
       VALUES ($1, $2, 'Main', '27', true, true, true)`,
      [BR, B]
    );
    await pool.query(
      `INSERT INTO users (id, business_id, name, phone, is_primary_admin) VALUES ($1, $2, 'Owner', $3, true)`,
      [U, B, `9${Date.now().toString().slice(-9)}`]
    );
    await pool.query(`SELECT create_default_chart_of_accounts($1)`, [B]);
    await pool.query(`SELECT ensure_standard_account_heads($1)`, [B]);
    await pool.query(
      `INSERT INTO customers (id, business_id, name, state_code, current_balance) VALUES ($1, $2, 'Asha Traders', '27', 0)`,
      [CUST, B]
    );
    await pool.query(
      `INSERT INTO suppliers (id, business_id, name, state_code, gstin, current_balance)
       VALUES ($1, $2, 'Bharat Supplies', '27', '27ABCDE1234F1Z5', 0)`,
      [SUPP, B]
    );
    await pool.query(
      `INSERT INTO items (id, business_id, name, item_type, purchase_price, selling_price, tax_rate, current_stock)
       VALUES ($1, $2, 'Widget', 'goods', 100, 150, 18, 0)`,
      [ITEM, B]
    );
  });

  afterAll(async () => {
    if (!pool) return;
    try {
      await tx(async (c) => {
        await withLedgerDelete(c, 'tenant_purge', U, async () => {
          await c.query(`DELETE FROM businesses WHERE id = $1`, [B]);
        });
      });
      await pool.query(`DELETE FROM ledger_entry_deletions WHERE business_id = $1`, [B]).catch(() => {});
    } finally {
      await closePool();
    }
  });

  afterEach(async () => {
    await expectBusinessBalanced();
  });

  // 1
  test('purchase delete of a final bill cancels it by reversal (nothing deleted)', async () => {
    const supplierBefore = await balanceOf('suppliers', SUPP);
    const stockBefore = await stock();
    const p = await makePurchase({ qty: 10, price: 100, gst: true, date: '2026-09-05' });
    const posted = await lines('purchase', p.id);
    expect(posted.length).toBeGreaterThan(0);

    await tx(async (c) => {
      await cancelFinalPurchase(c, {
        businessId: B,
        purchaseId: p.id,
        userId: U,
        reason: 'Deleted',
        warehouseModeEnabled: false,
      });
      await c.query(`UPDATE purchases SET deleted_at = CURRENT_TIMESTAMP WHERE id = $1`, [p.id]);
    });

    const doc = (await pool.query(`SELECT status, deleted_at, cancelled_at, balance_amount FROM purchases WHERE id = $1`, [p.id])).rows[0];
    expect(doc.status).toBe('cancelled');
    expect(doc.deleted_at).not.toBeNull();
    expect(doc.cancelled_at).not.toBeNull();
    expect(Number(doc.balance_amount)).toBe(0);

    const after = await lines('purchase', p.id);
    expect(after.length).toBe(posted.length * 2);
    for (const l of posted) expect(after.find((a) => a.id === l.id)?.reversed).toBe(true);
    expect(active(after)).toHaveLength(0);
    expect(net(after)).toEqual({});
    expect(after.filter((l) => l.is_reversal).every((l) => l.d === '2026-09-05')).toBe(true);
    expectVoucherConsistent(after);

    expect(await stock()).toBe(stockBefore);
    expect(await balanceOf('suppliers', SUPP)).toBeCloseTo(supplierBefore, 2);
    const outs = await pool.query(
      `SELECT quantity FROM stock_movements WHERE reference_type = 'purchase_cancel' AND reference_id = $1`,
      [p.id]
    );
    expect(outs.rows.map((r) => Number(r.quantity))).toEqual([10]);
    const ins = await pool.query(`SELECT 1 FROM stock_movements WHERE reference_type = 'purchase' AND reference_id = $1`, [p.id]);
    expect(ins.rows.length).toBe(1);
  });

  // 2 + 9 (purchase side)
  test('purchase cancel with a live payment is refused (409 PURCHASE_HAS_PAYMENTS), nothing reversed', async () => {
    const p = await makePurchase({ qty: 2, price: 100, gst: false, date: '2026-09-06' });
    const payId = await payPurchase(p.id, 50, '2026-09-07');
    const supplierBefore = await balanceOf('suppliers', SUPP);
    const billBefore = await lines('purchase', p.id);
    const payBefore = await lines('payment', payId);
    const stockBefore = await stock();

    const err = await errorOf(
      tx((c) => cancelFinalPurchase(c, { businessId: B, purchaseId: p.id, userId: U, reason: 'x', warehouseModeEnabled: false }))
    );
    expect(err?.status).toBe(409);
    expect(err?.code).toBe('PURCHASE_HAS_PAYMENTS');

    const doc = (await pool.query(`SELECT status, paid_amount FROM purchases WHERE id = $1`, [p.id])).rows[0];
    expect(doc.status).toBe('final');
    expect(Number(doc.paid_amount)).toBe(50);
    expect((await pool.query(`SELECT deleted_at FROM payments WHERE id = $1`, [payId])).rows[0].deleted_at).toBeNull();
    expect(await lines('purchase', p.id)).toEqual(billBefore);
    expect(await lines('payment', payId)).toEqual(payBefore);
    expect(active(payBefore)).toHaveLength(payBefore.length);
    expect(await balanceOf('suppliers', SUPP)).toBeCloseTo(supplierBefore, 2);
    expect(await stock()).toBe(stockBefore);
  });

  test('purchase cancel reverses bill and advance adjustment; releases the advance', async () => {
    const supplierBefore = await balanceOf('suppliers', SUPP);
    const cash = await accId('1101');
    const adv = await tx((c) =>
      createAdvance(c, {
        businessId: B,
        branchId: BR,
        userId: U,
        type: 'paid',
        partyId: SUPP,
        amount: 300,
        date: '2026-09-01',
        supplyType: 'goods',
        taxRate: 0,
        paymentAccountId: cash,
      })
    );
    const p = await makePurchase({ qty: 5, price: 200, gst: true, date: '2026-09-06' });
    await tx((c) =>
      adjustAdvance(c, { businessId: B, branchId: BR, userId: U, advanceId: adv.id, purchaseId: p.id, amount: 300, date: '2026-09-08' })
    );
    const adjRow = (await pool.query(`SELECT id, voucher_id FROM advance_adjustments WHERE advance_id = $1`, [adv.id])).rows[0];
    expect((await pool.query(`SELECT status FROM advance_payments WHERE id = $1`, [adv.id])).rows[0].status).toBe('adjusted');

    const res = await tx((c) =>
      cancelFinalPurchase(c, {
        businessId: B,
        purchaseId: p.id,
        userId: U,
        reason: 'Wrong supplier',
        warehouseModeEnabled: false,
      })
    );
    expect(res.releasedAdvance).toBe(300);

    const doc = (
      await pool.query(`SELECT status, paid_amount, advance_adjusted, cancellation_reason FROM purchases WHERE id = $1`, [p.id])
    ).rows[0];
    expect(doc.status).toBe('cancelled');
    expect(Number(doc.paid_amount)).toBe(0);
    expect(Number(doc.advance_adjusted)).toBe(0);
    expect(doc.cancellation_reason).toBe('Wrong supplier');

    for (const [type, id] of [
      ['purchase', p.id],
      ['advance_adjustment', adjRow.voucher_id],
    ] as const) {
      const rows = await lines(type, id);
      expect(rows.length).toBeGreaterThan(0);
      expect(active(rows)).toHaveLength(0);
      expect(net(rows)).toEqual({});
      expectVoucherConsistent(rows);
    }

    const adjAfter = (await pool.query(`SELECT reversed_at FROM advance_adjustments WHERE id = $1`, [adjRow.id])).rows[0];
    expect(adjAfter.reversed_at).not.toBeNull();
    const advAfter = (await pool.query(`SELECT status, adjusted_amount FROM advance_payments WHERE id = $1`, [adv.id])).rows[0];
    expect(advAfter.status).toBe('open');
    expect(Number(advAfter.adjusted_amount)).toBe(0);
    // The released advance stays open on the advance, not on the supplier balance.
    expect(await balanceOf('suppliers', SUPP)).toBeCloseTo(supplierBefore, 2);

    const again = await errorOf(
      tx((c) =>
        cancelFinalPurchase(c, {
          businessId: B,
          purchaseId: p.id,
          userId: U,
          reason: null,
          warehouseModeEnabled: false,
        })
      )
    );
    expect(again?.status).toBe(409);
  });

  test('purchase cancel is refused (no clamping) when received stock is no longer on hand', async () => {
    const p = await makePurchase({ qty: 4, price: 50, gst: false, date: '2026-09-09' });
    const onHand = await stock();
    await tx(async (c) => {
      await adjustBranchItemStock(c, B, BR, ITEM, -onHand + 1);
      await refreshItemGlobalStockFromBranches(c, B, ITEM);
    });
    const before = await lines('purchase', p.id);

    const err = await errorOf(
      tx((c) =>
        cancelFinalPurchase(c, {
          businessId: B,
          purchaseId: p.id,
          userId: U,
          reason: null,
          warehouseModeEnabled: false,
        })
      )
    );
    expect(err).not.toBeNull();
    expect(err?.status).toBe(409);
    expect(err?.code).toBe('PURCHASE_STOCK_CONSUMED');

    expect((await pool.query(`SELECT status FROM purchases WHERE id = $1`, [p.id])).rows[0].status).toBe('final');
    expect(await lines('purchase', p.id)).toEqual(before);
    expect(await stock()).toBe(1);
  });

  // 3 + 4
  test('invoice re-post reverses the old posting and keeps recorded payments', async () => {
    const inv = await makeInvoice({ taxable: 1000, gst: true, date: '2026-09-10' });
    const payId = await tx(async (c) => {
      const id = (
        await c.query<{ id: string }>(
          `INSERT INTO payments (business_id, branch_id, type, customer_id, reference_type, reference_id, amount, payment_mode, payment_date)
           VALUES ($1, $2, 'receivable', $3, 'invoice', $4, 400, 'cash', '2026-09-11') RETURNING id`,
          [B, BR, CUST, inv.id]
        )
      ).rows[0].id;
      await createPaymentLedgerEntries({
        businessId: B,
        paymentId: id,
        paymentDate: '2026-09-11',
        amount: 400,
        type: 'receivable',
        customerId: CUST,
        paymentMode: 'cash',
        branchId: BR,
        poolClient: c,
      });
      return id;
    });
    const payBefore = await lines('payment', payId);
    const invBefore = await lines('invoice', inv.id);

    await tx(async (c) => {
      await reverseInvoicePostingForRepost(c, { businessId: B, invoiceId: inv.id, invoiceNumber: inv.no, userId: U });
      await createInvoiceLedgerEntries({
        businessId: B,
        invoiceId: inv.id,
        invoiceNumber: inv.no,
        invoiceDate: '2026-09-10',
        grandTotal: 1416,
        customerId: CUST,
        isCashSale: false,
        branchId: BR,
        taxableValue: 1200,
        cgstTotal: 108,
        sgstTotal: 108,
        poolClient: c,
      });
    });

    const invAfter = await lines('invoice', inv.id);
    expect(invAfter.length).toBe(invBefore.length * 3);
    for (const l of invBefore) expect(invAfter.find((a) => a.id === l.id)?.reversed).toBe(true);
    const act = active(invAfter);
    expect(net(act)['4101']).toBe(-1200);
    expect(net(act)['2150']).toBe(-108);
    expect(net(act)['2151']).toBe(-108);
    expect(r2(act.reduce((s, r) => s + r.dr, 0))).toBe(1416);
    expect(net(invAfter)).toEqual(net(act));
    expectVoucherConsistent(invAfter);

    // Scenario 4: the receipt voucher was not touched by the re-post.
    expect(await lines('payment', payId)).toEqual(payBefore);
    expect(active(payBefore)).toHaveLength(payBefore.length);

    // Explicit payment replacement reverses (not deletes) the old receipt voucher.
    const replaced = await tx((c) => reverseReplacedInvoicePayments(c, { businessId: B, invoiceId: inv.id, userId: U }));
    expect(replaced).toEqual([payId]);
    const payAfter = await lines('payment', payId);
    expect(payAfter.length).toBe(payBefore.length * 2);
    expect(net(payAfter)).toEqual({});
    expectVoucherConsistent(payAfter);
  });

  // 9 (invoice side) + 10
  test('invoice cancel releases the adjusted advance; the advance can be re-used and re-released', async () => {
    const custBefore = await balanceOf('customers', CUST);
    const cash = await accId('1101');
    const adv = await tx((c) =>
      createAdvance(c, {
        businessId: B,
        branchId: BR,
        userId: U,
        type: 'received',
        partyId: CUST,
        amount: 500,
        date: '2026-09-02',
        supplyType: 'goods',
        taxRate: 0,
        paymentAccountId: cash,
      })
    );

    for (let round = 0; round < 2; round++) {
      const inv = await makeInvoice({ taxable: 1000, gst: false, date: '2026-09-12' });
      await tx((c) =>
        adjustAdvance(c, { businessId: B, branchId: BR, userId: U, advanceId: adv.id, invoiceId: inv.id, amount: 500, date: '2026-09-12' })
      );
      expect(await balanceOf('customers', CUST)).toBeCloseTo(custBefore + 500, 2);

      const res = await tx(async (c) => {
        await c.query(`UPDATE invoices SET status = 'cancelled' WHERE id = $1`, [inv.id]);
        return reverseInvoiceAccountingOnCancel(
          c,
          { id: inv.id, business_id: B, invoice_number: inv.no, customer_id: CUST, document_type: 'tax_invoice', grand_total: inv.grand },
          U
        );
      });
      expect(res.releasedAdvance).toBe(500);
      expect(await balanceOf('customers', CUST)).toBeCloseTo(custBefore, 2);

      const invRows = await lines('invoice', inv.id);
      expect(active(invRows)).toHaveLength(0);
      expect(net(invRows)).toEqual({});
      expectVoucherConsistent(invRows);

      const adjs = (
        await pool.query(`SELECT voucher_id, reversed_at FROM advance_adjustments WHERE invoice_id = $1`, [inv.id])
      ).rows;
      expect(adjs).toHaveLength(1);
      expect(adjs[0].reversed_at).not.toBeNull();
      const adjRows = await lines('advance_adjustment', adjs[0].voucher_id);
      expect(net(adjRows)).toEqual({});
      expectVoucherConsistent(adjRows);

      const a = (await pool.query(`SELECT status, adjusted_amount FROM advance_payments WHERE id = $1`, [adv.id])).rows[0];
      expect(a.status).toBe('open');
      expect(Number(a.adjusted_amount)).toBe(0);
      expect(Number((await pool.query(`SELECT advance_adjusted FROM invoices WHERE id = $1`, [inv.id])).rows[0].advance_adjusted)).toBe(0);

      // Releasing again is a no-op.
      const again = await tx((c) =>
        reverseVoucherLedgerEntries(c, { businessId: B, voucherType: 'invoice', voucherId: inv.id, reason: 'again' })
      );
      expect(again).toBe(0);
    }
  });

  // 5 + 6 + 10
  test('expense edit reverses and re-posts; delete reverses; repeated cycles never compound', async () => {
    const e = await makeExpense(1000, '2026-09-14');
    expect(net(await lines('expense', e.id))).toEqual({ '5201': 1000, '1101': -1000 });

    expect(await editExpense(e, 1200)).toBe(true);
    let rows = await lines('expense', e.id);
    expect(rows).toHaveLength(6);
    expect(net(active(rows))).toEqual({ '5201': 1200, '1101': -1200 });
    expect(net(rows)).toEqual({ '5201': 1200, '1101': -1200 });
    expect(Number((await loadExpense(e.id)).amount)).toBe(1200);
    expectVoucherConsistent(rows);

    expect(await editExpense(await loadExpense(e.id), 1500)).toBe(true);
    rows = await lines('expense', e.id);
    expect(rows).toHaveLength(10);
    expect(net(active(rows))).toEqual({ '5201': 1500, '1101': -1500 });
    expectVoucherConsistent(rows);

    expect(
      await tx((c) => deleteExpenseByReversal(c, { businessId: B, userId: U, old: e, reason: 'Duplicate entry' }))
    ).toBe(true);
    rows = await lines('expense', e.id);
    expect(rows).toHaveLength(12);
    expect(active(rows)).toHaveLength(0);
    expect(net(rows)).toEqual({});
    expect(rows.filter((r) => r.reversed)).toHaveLength(6);
    expectVoucherConsistent(rows);

    const doc = await loadExpense(e.id);
    expect(doc.deleted_at).not.toBeNull();
    expect(
      (await pool.query(`SELECT delete_reason FROM expenses WHERE id = $1`, [e.id])).rows[0].delete_reason
    ).toBe('Duplicate entry');

    expect(await tx((c) => deleteExpenseByReversal(c, { businessId: B, userId: U, old: e, reason: null }))).toBe(false);
    expect(await editExpense(e, 900)).toBe(false);
    expect(await lines('expense', e.id)).toHaveLength(12);
  });

  // 7 + 8
  test('journal correction reverses and re-posts; delete reverses and soft-deletes the header', async () => {
    const voucherId = randomUUID();
    const expense = await accId('5201');
    const cash = await accId('1101');
    const bank = await accId('1102');
    await tx(async (c) => {
      await c.query(
        `INSERT INTO journal_entries (business_id, voucher_id, voucher_number, entry_date, narration, branch_id, created_by)
         VALUES ($1, $2, $3, '2026-09-15', 'Repairs', $4, $5)`,
        [B, voucherId, `JV-${tag}`, BR, U]
      );
      const r = await repostJournal(c, {
        businessId: B,
        voucherId,
        userId: U,
        branchId: BR,
        entryDate: '2026-09-15',
        lines: [
          { account_id: expense, debit: 700, credit: 0 },
          { account_id: cash, debit: 0, credit: 700 },
        ],
        narration: 'Repairs',
        reference: null,
        voucherNumber: `JV-${tag}`,
      });
      expect(r).toEqual({ reversed: 0, posted: 2 });
    });

    const fixed = await tx((c) =>
      repostJournal(c, {
        businessId: B,
        voucherId,
        userId: U,
        branchId: BR,
        entryDate: '2026-09-16',
        lines: [
          { account_id: expense, debit: 900, credit: 0 },
          { account_id: bank, debit: 0, credit: 900 },
        ],
        narration: 'Repairs (corrected)',
        reference: null,
        voucherNumber: `JV-${tag}`,
      })
    );
    expect(fixed).toEqual({ reversed: 2, posted: 2 });
    let rows = await lines('journal', voucherId);
    expect(rows).toHaveLength(6);
    expect(net(active(rows))).toEqual({ '5201': 900, '1102': -900 });
    expect(net(rows)).toEqual({ '5201': 900, '1102': -900 });
    expect(rows.filter((r) => r.is_reversal).every((r) => r.d === '2026-09-15')).toBe(true);
    expectVoucherConsistent(rows);

    const mirror = await pool.query<{ dr: string; cr: string }>(
      `SELECT SUM(debit) AS dr, SUM(credit) AS cr FROM ledger_entries WHERE business_id = $1 AND transaction_id = $2`,
      [B, voucherId]
    );
    expect(Number(mirror.rows[0].dr)).toBe(Number(mirror.rows[0].cr));

    expect(await tx((c) => deleteJournalByReversal(c, { businessId: B, voucherId, userId: U, reason: 'Posted twice' }))).toBe(true);
    rows = await lines('journal', voucherId);
    expect(rows).toHaveLength(8);
    expect(active(rows)).toHaveLength(0);
    expect(net(rows)).toEqual({});
    expectVoucherConsistent(rows);
    const head = (await pool.query(`SELECT deleted_at, delete_reason FROM journal_entries WHERE voucher_id = $1`, [voucherId])).rows[0];
    expect(head.deleted_at).not.toBeNull();
    expect(head.delete_reason).toBe('Posted twice');
    expect(await tx((c) => deleteJournalByReversal(c, { businessId: B, voucherId, userId: U, reason: null }))).toBe(false);
  });

  // 11
  test('corrections in a locked period are refused and leave books unchanged', async () => {
    const e = await makeExpense(800, '2026-04-10');
    const before = await lines('expense', e.id);
    await pool.query(
      `INSERT INTO period_locks (business_id, branch_id, financial_year, period_start, period_end, is_locked, locked_by)
       VALUES ($1, NULL, '2026-27', '2026-04-01', '2026-04-30', true, $2)`,
      [B, U]
    );

    const guard = await periodGuardResponse({ businessId: B, branchId: BR, dates: ['2026-04-10'], action: 'edit expense' });
    expect(guard?.status).toBe(403);
    expect((await guard!.json()).code).toBe('PERIOD_LOCKED');

    expect(await errorOf(editExpense(e, 950))).not.toBeNull();
    expect(
      await errorOf(tx((c) => deleteExpenseByReversal(c, { businessId: B, userId: U, old: e, reason: null })))
    ).not.toBeNull();

    expect(await lines('expense', e.id)).toEqual(before);
    const doc = await loadExpense(e.id);
    expect(Number(doc.amount)).toBe(800);
    expect(doc.deleted_at).toBeNull();
  });

  // 12
  test('corrections in a filed GST period are refused at the route guard', async () => {
    await pool.query(
      `INSERT INTO gst_filings (business_id, branch_id, gst_period, status, filed_at) VALUES ($1, NULL, '2026-08', 'filed', NOW())`,
      [B]
    );
    const guard = await periodGuardResponse({
      businessId: B,
      branchId: BR,
      dates: ['2026-08-12'],
      action: 'edit expense',
      checkGstFiled: true,
    });
    expect(guard?.status).toBe(403);
    expect((await guard!.json()).code).toBe('GST_PERIOD_FILED');
    await expect(assertGstPeriodNotFiledForDocumentDate(B, BR, '2026-08-05', 'cancel purchase')).rejects.toThrow(/filed/);
    await expect(assertGstPeriodNotFiledForDocumentDate(B, BR, '2026-09-05', 'cancel purchase')).resolves.toBeUndefined();
    const open = await periodGuardResponse({
      businessId: B,
      branchId: BR,
      dates: ['2026-09-12'],
      action: 'edit expense',
      checkGstFiled: true,
    });
    expect(open).toBeNull();
  });

  test('database invariants: no deletes, one reversal per line, no reversal of a reversal, append-only links', async () => {
    const e = await makeExpense(300, '2026-09-20');
    await tx((c) => reverseVoucherLedgerEntries(c, { businessId: B, voucherType: 'expense', voucherId: e.id, reason: 'test' }));
    const rows = await lines('expense', e.id);
    const orig = rows.find((r) => r.reversed)!;
    const rev = rows.find((r) => r.is_reversal)!;
    const other = rows.find((r) => r.reversed && r.id !== orig.id)!;

    expect(
      await tx((c) => reverseVoucherLedgerEntries(c, { businessId: B, voucherType: 'expense', voucherId: e.id, reason: 'again' }))
    ).toBe(0);

    const link = (a: string, b: string) =>
      tx((c) =>
        c.query(
          `INSERT INTO ledger_entry_reversals (original_line_id, reversal_line_id, business_id, voucher_type, voucher_id, reason)
           VALUES ($1, $2, $3, 'expense', $4, 'x')`,
          [a, b, B, e.id]
        )
      );
    expect(await errorOf(link(orig.id, other.id))).not.toBeNull();
    expect(await errorOf(link(rev.id, orig.id))).not.toBeNull();

    expect(await errorOf(pool.query(`DELETE FROM ledger_entry_lines WHERE id = $1`, [orig.id]))).not.toBeNull();
    expect(await errorOf(pool.query(`UPDATE ledger_entry_reversals SET reason = 'y' WHERE original_line_id = $1`, [orig.id]))).not.toBeNull();
    expect(await errorOf(pool.query(`DELETE FROM ledger_entry_reversals WHERE original_line_id = $1`, [orig.id]))).not.toBeNull();
    expect(await lines('expense', e.id)).toEqual(rows);
  });

  test('migration 324 backfill links legacy "Reversal:" lines once, and re-running adds nothing', async () => {
    const v = randomUUID();
    const expense = await accId('5201');
    const cash = await accId('1101');
    await tx(async (c) => {
      const ins = (acc: string, dr: number, cr: number, narr: string) =>
        c.query(
          `INSERT INTO ledger_entry_lines (business_id, branch_id, voucher_id, voucher_type, account_id, entry_date, debit, credit, narration)
           VALUES ($1, $2, $3, 'credit_note', $4, '2026-09-21', $5, $6, $7)`,
          [B, BR, v, acc, dr, cr, narr]
        );
      await ins(expense, 250, 0, 'CN');
      await ins(cash, 0, 250, 'CN');
      await ins(expense, 0, 250, 'Reversal: legacy (CN)');
      await ins(cash, 250, 0, 'Reversal: legacy (CN)');
    });
    expect(active(await lines('credit_note', v))).toHaveLength(4);

    await tx((c) => c.query(migration324));
    let rows = await lines('credit_note', v);
    expect(rows.filter((r) => r.reversed)).toHaveLength(2);
    expect(rows.filter((r) => r.is_reversal)).toHaveLength(2);
    expect(active(rows)).toHaveLength(0);
    expectVoucherConsistent(rows);

    await tx((c) => c.query(migration324));
    expect(await lines('credit_note', v)).toEqual(rows);
    const links = await pool.query(`SELECT 1 FROM ledger_entry_reversals WHERE voucher_id = $1`, [v]);
    expect(links.rows.length).toBe(2);
  });
});
