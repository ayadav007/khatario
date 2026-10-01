/**
 * Phase 4.4: whole payment reversal via POST /api/payments/[id]/reverse.
 * Runs only when PHASE2_TEST_DATABASE_URL points at a disposable database. Migration 335 (and the
 * store payment migration 330 it reads) is applied to that database in beforeAll; both are
 * idempotent.
 */
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import type { Pool, PoolClient } from 'pg';
import { NextRequest } from 'next/server';

const url = process.env.PHASE2_TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
const d = url ? describe : describe.skip;

jest.mock('@/lib/jwt', () => ({ clearSessionCookie: jest.fn() }));
jest.mock('@/lib/credit-alerts', () => ({ checkAndSendCreditAlerts: jest.fn() }));
jest.mock('@/lib/authorization', () => ({
  ...jest.requireActual('@/lib/authorization'),
  authorize: jest.fn(),
}));
jest.mock('@/lib/enforce-access', () => ({
  ...jest.requireActual('@/lib/enforce-access'),
  enforceAccess: jest.fn().mockResolvedValue(undefined),
  enforceAccessErrorResponse: jest.fn(() => null),
}));
jest.mock('@/lib/subscription/feature-access', () => ({
  ...jest.requireActual('@/lib/subscription/feature-access'),
  assertFeatureAccess: jest.fn().mockResolvedValue(undefined),
  assertReportAccess: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/lib/branch-access', () => ({
  ...jest.requireActual('@/lib/branch-access'),
  getUserAccessibleBranchIds: jest.fn(),
}));
jest.mock('@/lib/activity-logger', () => ({
  logActivity: jest.fn().mockResolvedValue(undefined),
  getClientIP: jest.fn(() => '127.0.0.1'),
  getUserAgent: jest.fn(() => 'jest'),
}));

import { getPool, closePool } from '@/lib/db';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { getUserAccessibleBranchIds } from '@/lib/branch-access';
import { withLedgerDelete } from '@/lib/accounting/ledger-delete-guard';
import * as invoiceBalance from '@/lib/invoices/invoice-balance';
import { cancelPostedInvoiceInTransaction } from '@/lib/invoices/cancel-final-invoice';
import { cancelFinalPurchase } from '@/lib/purchases/cancel-purchase';
import { getPaymentPolicies } from '@/lib/policies/resources/payments';
import { PERMISSION_MODULE_PLATFORM } from '@/lib/rbac-permission-catalog';
import { POST as postPayment } from '@/app/api/payments/route';
import { POST as reversePayment } from '@/app/api/payments/[id]/reverse/route';
import { GET as agingReceivables } from '@/app/api/reports/aging/receivables/route';
import { GET as cashFlow } from '@/app/api/dashboard/cash-flow/route';
import { GET as partyLedger } from '@/app/api/reports/party/ledger/route';

const authorizeMock = authorize as jest.Mock;
const branchAccessMock = getUserAccessibleBranchIds as jest.Mock;

const migration330 = fs.readFileSync(
  path.join(__dirname, '../../database/migrations/330_store_payment_lifecycle.sql'),
  'utf8'
);
const migration335 = fs.readFileSync(
  path.join(__dirname, '../../database/migrations/335_payment_reversal.sql'),
  'utf8'
);

d('Phase 4.4 payment reversal (real DB)', () => {
  jest.setTimeout(180000);

  let pool: Pool;
  const B = randomUUID();
  const B2 = randomUUID();
  const BR = randomUUID();
  const BR2 = randomUUID();
  const A = randomUUID();
  const OTHER = randomUUID();
  const CUST = randomUUID();
  const CUST_REPORT = randomUUID();
  const SUPP = randomUUID();
  const FOREIGN_CUST = randomUUID();
  const tag = B.slice(0, 8);
  let TODAY = '';
  let PAY_DATE = '';

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

  const spoof = { user_id: OTHER, created_by: OTHER, business_id: B2, reversed_by: OTHER };
  const key = () => `rev-${randomUUID()}`;

  const call = async (res: Response | Promise<Response>) => {
    const r = await res;
    const json = await r.json().catch(() => ({}));
    return { status: r.status, json: json as any, replayed: r.headers.get('Idempotent-Replayed') };
  };

  const headers = (extra: Record<string, string> = {}) => ({
    'content-type': 'application/json',
    'x-user-id': OTHER,
    'x-authenticated-user-id': A,
    'x-authenticated-business-id': B,
    ...extra,
  });

  const createPayment = (body: Record<string, unknown>, k?: string) =>
    call(
      postPayment(
        new NextRequest(`http://localhost/api/payments?user_id=${OTHER}&business_id=${B2}`, {
          method: 'POST',
          headers: headers(k ? { 'X-Idempotency-Key': k } : {}),
          body: JSON.stringify({ ...spoof, payment_mode: 'cash', payment_date: PAY_DATE, ...body }),
        })
      )
    );

  const reverse = (paymentId: string, body: Record<string, unknown> | null, extraHeaders: Record<string, string> = {}) =>
    call(
      reversePayment(
        new NextRequest(`http://localhost/api/payments/${paymentId}/reverse?user_id=${OTHER}&business_id=${B2}`, {
          method: 'POST',
          headers: headers(extraHeaders),
          body: body === null ? undefined : JSON.stringify(body),
        }),
        { params: { id: paymentId } }
      )
    );

  const rev = (paymentId: string, reason = 'Entered against the wrong party', k = key()) =>
    reverse(paymentId, { ...spoof, reason }, { 'X-Idempotency-Key': k });

  async function makeInvoice(grand: number, customerId = CUST) {
    const id = randomUUID();
    await pool.query(
      `INSERT INTO invoices (id, business_id, customer_id, invoice_number, invoice_date, status, document_type,
          place_of_supply_state_code, subtotal, tax_total, cgst_total, sgst_total, igst_total, grand_total,
          paid_amount, balance_amount, payment_status, branch_id)
       VALUES ($1, $2, $3, $4, $5, 'final', 'tax_invoice', '27', $6, 0, 0, 0, 0, $6, 0, $6, 'unpaid', $7)`,
      [id, B, customerId, `INV-${tag}-${id.slice(0, 6)}`, PAY_DATE, grand, BR]
    );
    return id;
  }

  async function makePurchase(grand: number) {
    const id = randomUUID();
    await pool.query(
      `INSERT INTO purchases (id, business_id, supplier_id, bill_number, bill_date, status, place_of_supply_state_code,
          is_reverse_charge, itc_eligible, subtotal, tax_total, cgst_total, sgst_total, igst_total, grand_total,
          paid_amount, balance_amount, payment_status, branch_id)
       VALUES ($1, $2, $3, $4, $5, 'final', '27', false, true, $6, 0, 0, 0, 0, $6, 0, $6, 'unpaid', $7)`,
      [id, B, SUPP, `PB-${tag}-${id.slice(0, 6)}`, PAY_DATE, grand, BR]
    );
    return id;
  }

  async function receipt(amount: number, extra: Record<string, unknown> = {}, k?: string) {
    const res = await createPayment({ type: 'receivable', customer_id: CUST, amount, ...extra }, k);
    expect(res.status).toBe(201);
    return res.json.payment as Record<string, any>;
  }

  async function supplierPayment(amount: number, extra: Record<string, unknown> = {}) {
    const res = await createPayment({ type: 'payable', supplier_id: SUPP, amount, ...extra });
    expect(res.status).toBe(201);
    return res.json.payment as Record<string, any>;
  }

  /** Whole-row fingerprints of everything a reversal may touch, across both businesses. */
  async function snapshot() {
    const rowsHash = (table: string, alias: string) =>
      `(SELECT md5(COALESCE(string_agg(${alias}::text, '|' ORDER BY ${alias}.id), '')) FROM ${table} ${alias}
         WHERE ${alias}.business_id = ANY($1::uuid[]))`;
    return (
      await pool.query(
        `SELECT ${rowsHash('payments', 'p')} AS payments,
                ${rowsHash('invoices', 'i')} AS invoices,
                ${rowsHash('purchases', 'pu')} AS purchases,
                ${rowsHash('customers', 'c')} AS customers,
                ${rowsHash('suppliers', 's')} AS suppliers,
                ${rowsHash('tds_transactions', 't')} AS tds,
                ${rowsHash('offline_replay_log', 'o')} AS keys,
                ${rowsHash('payment_reversals', 'r')} AS reversals,
                (SELECT COUNT(*)::int FROM ledger_entry_lines WHERE business_id = ANY($1::uuid[])) AS lines,
                (SELECT COUNT(*)::int FROM ledger_entry_reversals WHERE business_id = ANY($1::uuid[])) AS links`,
        [[B, B2]]
      )
    ).rows[0] as Record<string, string | number>;
  }

  async function voucherLines(voucherId: string) {
    return (
      await pool.query(
        `SELECT l.id, a.account_code AS code, l.debit::float8 AS dr, l.credit::float8 AS cr, l.entry_date::text AS entry_date,
                ler.original_line_id AS reverses
           FROM ledger_entry_lines l
           JOIN accounts a ON a.id = l.account_id
           LEFT JOIN ledger_entry_reversals ler ON ler.reversal_line_id = l.id
          WHERE l.business_id = $1 AND l.voucher_type = 'payment' AND l.voucher_id = $2
          ORDER BY l.created_at, a.account_code, l.id`,
        [B, voucherId]
      )
    ).rows as Array<{ id: string; code: string; dr: number; cr: number; entry_date: string; reverses: string | null }>;
  }

  /** Every original line has exactly one exact-mirror reversal line dated `date`, linked to it. */
  function expectMirrored(lines: Awaited<ReturnType<typeof voucherLines>>, date: string) {
    const originals = lines.filter((l) => !l.reverses);
    const mirrors = lines.filter((l) => l.reverses);
    expect(originals.length).toBeGreaterThan(0);
    expect(mirrors).toHaveLength(originals.length);
    for (const o of originals) {
      const m = mirrors.filter((x) => x.reverses === o.id);
      expect(m).toHaveLength(1);
      expect({ code: m[0].code, dr: m[0].dr, cr: m[0].cr }).toEqual({ code: o.code, dr: o.cr, cr: o.dr });
      expect(m[0].entry_date).toBe(date);
    }
  }

  const balanceOf = async (table: 'customers' | 'suppliers', id: string) =>
    Number((await pool.query(`SELECT current_balance FROM ${table} WHERE id = $1`, [id])).rows[0].current_balance);

  const invoiceRow = async (id: string) =>
    (
      await pool.query(
        `SELECT status, grand_total::float8 AS grand, paid_amount::float8 AS paid, COALESCE(tds_received, 0)::float8 AS tds,
                balance_amount::float8 AS balance, payment_status
           FROM invoices WHERE id = $1`,
        [id]
      )
    ).rows[0];

  const purchaseRow = async (id: string) =>
    (
      await pool.query(
        `SELECT status, paid_amount::float8 AS paid, COALESCE(tds_deducted, 0)::float8 AS tds,
                balance_amount::float8 AS balance, payment_status
           FROM purchases WHERE id = $1`,
        [id]
      )
    ).rows[0];

  const reversalKeyRow = async (k: string) =>
    (
      await pool.query(
        `SELECT status, action_type, entity_type, entity_id::text AS entity_id, request_payload
           FROM offline_replay_log WHERE business_id = $1 AND idempotency_key = $2`,
        [B, `payments.reverse:${k}`]
      )
    ).rows[0];

  beforeAll(async () => {
    pool = getPool();
    await pool.query(migration330);
    await pool.query(migration335);
    TODAY = (await pool.query(`SELECT CURRENT_DATE::text AS d`)).rows[0].d;
    PAY_DATE = (await pool.query(`SELECT (CURRENT_DATE - 40)::text AS d`)).rows[0].d;

    await pool.query(
      `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type)
       VALUES ($1, $2, $3, '27', 'regular'), ($4, $5, $6, '29', 'regular')`,
      [B, `Phase44 ${tag}`, `27AABCU${tag.slice(0, 4).toUpperCase()}E1Z5`, B2, `Phase44b ${tag}`, `29AABCU${tag.slice(0, 4).toUpperCase()}F1Z5`]
    );
    await pool.query(
      `INSERT INTO branches (id, business_id, name, state_code, is_primary, is_default, is_active)
       VALUES ($1, $2, 'Main', '27', true, true, true), ($3, $4, 'Main', '29', true, true, true)`,
      [BR, B, BR2, B2]
    );
    const phone = Date.now().toString().slice(-8);
    await pool.query(
      `INSERT INTO users (id, business_id, name, phone, is_primary_admin)
       VALUES ($1, $2, 'Clerk', $3, true), ($4, $2, 'Other', $5, false)`,
      [A, B, `95${phone}`, OTHER, `96${phone}`]
    );
    for (const biz of [B, B2]) {
      await pool.query(`SELECT create_default_chart_of_accounts($1)`, [biz]);
      await pool.query(`SELECT ensure_standard_account_heads($1)`, [biz]);
    }
    await pool.query(
      `INSERT INTO customers (id, business_id, name, state_code, current_balance)
       VALUES ($1, $2, 'Asha', '27', 5000), ($3, $2, 'Report Co', '27', 0), ($4, $5, 'Foreign', '29', 50)`,
      [CUST, B, CUST_REPORT, FOREIGN_CUST, B2]
    );
    await pool.query(
      `INSERT INTO suppliers (id, business_id, name, state_code, current_balance)
       VALUES ($1, $2, 'Bharat', '27', 5000)`,
      [SUPP, B]
    );
  });

  afterAll(async () => {
    if (!pool) return;
    try {
      await pool.query(`DELETE FROM period_locks WHERE business_id = ANY($1::uuid[])`, [[B, B2]]).catch(() => {});
      await pool.query(`DELETE FROM gst_filings WHERE business_id = ANY($1::uuid[])`, [[B, B2]]).catch(() => {});
      await pool.query(`DELETE FROM store_orders WHERE business_id = ANY($1::uuid[])`, [[B, B2]]).catch(() => {});
      await tx(async (c) => {
        await withLedgerDelete(c, 'tenant_purge', A, async () => {
          await c.query(`DELETE FROM businesses WHERE id = ANY($1::uuid[])`, [[B, B2]]);
        });
      });
      await pool.query(`DELETE FROM ledger_entry_deletions WHERE business_id = ANY($1::uuid[])`, [[B, B2]]).catch(() => {});
    } finally {
      await closePool();
    }
  });

  beforeEach(async () => {
    jest.restoreAllMocks();
    authorizeMock.mockReset();
    authorizeMock.mockImplementation(async (userId: string) => {
      if (userId !== A) throw new AuthorizationError('Not allowed', 'FORBIDDEN');
    });
    branchAccessMock.mockReset();
    branchAccessMock.mockResolvedValue([BR]);
    await pool.query(`DELETE FROM period_locks WHERE business_id = $1`, [B]);
    await pool.query(`DELETE FROM gst_filings WHERE business_id = $1`, [B]);
  });

  test('permission: payments:reverse is the payment_reversals Create permission with its own policy', () => {
    const policy = getPaymentPolicies().find((p) => p.resource === 'payment_reversals' && p.action === 'create');
    expect(policy).toMatchObject({ requiresPermission: 'payment_reversals.create' });
    expect(PERMISSION_MODULE_PLATFORM.payment_reversals).toBe('billing');
  });

  test('customer receipt with TDS: mirrored, original kept, invoice reopened, tds_received and balance restored', async () => {
    const inv = await makeInvoice(1000);
    const custBefore = await balanceOf('customers', CUST);
    const pay = await receipt(900, { reference_type: 'invoice', reference_id: inv, tds_amount: 100, customer_id: undefined });
    expect(await invoiceRow(inv)).toMatchObject({ paid: 900, tds: 100, balance: 0, payment_status: 'paid' });
    expect(await balanceOf('customers', CUST)).toBeCloseTo(custBefore - 1000, 2);
    const originalLines = await voucherLines(pay.id);
    expect(originalLines.map((l) => [l.code, l.dr, l.cr])).toEqual(
      expect.arrayContaining([
        ['1103', 0, 1000],
        ['1116', 100, 0],
      ])
    );

    const res = await rev(pay.id, '  Receipt keyed twice  ');
    expect(res.status).toBe(201);
    expect(res.replayed).toBeNull();
    const { reversal, payment } = res.json;
    expect(reversal).toMatchObject({
      business_id: B,
      payment_id: pay.id,
      reversal_date: TODAY,
      reason: 'Receipt keyed twice',
      document_effect: 'document_reopened',
      reversed_line_count: originalLines.length,
      created_by: A,
    });
    expect(Number(reversal.amount)).toBe(900);
    expect(Number(reversal.tds_amount)).toBe(100);
    expect(payment).toMatchObject({
      id: pay.id,
      status: 'reversed',
      reversed_by: A,
      reversal_reason: 'Receipt keyed twice',
      reversal_id: reversal.id,
      deleted_at: null,
      created_by: A,
    });
    expect(Number(payment.amount)).toBe(900);
    expect(Number(payment.tds_amount)).toBe(100);
    expect(authorizeMock).toHaveBeenCalledWith(A, 'payment_reversals', 'create', { businessId: B, branchId: BR });
    expect(authorizeMock.mock.calls.every((c) => c[0] === A)).toBe(true);

    const after = await voucherLines(pay.id);
    expect(after.filter((l) => !l.reverses)).toEqual(originalLines);
    expectMirrored(after, TODAY);
    expect(after.filter((l) => !l.reverses).every((l) => l.entry_date === PAY_DATE)).toBe(true);

    expect(await invoiceRow(inv)).toMatchObject({ status: 'final', grand: 1000, paid: 0, tds: 0, balance: 1000, payment_status: 'unpaid' });
    expect(await balanceOf('customers', CUST)).toBeCloseTo(custBefore, 2);
  });

  test('supplier payment with undeposited TDS: mirrored, bill reopened, TDS row cancelled (kept), then the bill can be cancelled', async () => {
    const pur = await makePurchase(500);
    const suppBefore = await balanceOf('suppliers', SUPP);
    const pay = await supplierPayment(450, {
      reference_type: 'purchase',
      reference_id: pur,
      tds_amount: 50,
      tds_section: '194C',
      supplier_id: undefined,
    });
    const tdsRow = (await pool.query(`SELECT id, status FROM tds_transactions WHERE payment_id = $1`, [pay.id])).rows;
    expect(tdsRow).toHaveLength(1);
    expect(tdsRow[0].status).toBe('active');
    expect(await purchaseRow(pur)).toMatchObject({ paid: 450, tds: 50, balance: 0 });

    const res = await rev(pay.id, 'Paid the wrong bill');
    expect(res.status).toBe(201);
    expect(res.json.reversal).toMatchObject({ document_effect: 'document_reopened', cancelled_tds_transaction_ids: [tdsRow[0].id] });
    expectMirrored(await voucherLines(pay.id), TODAY);
    expect(await purchaseRow(pur)).toMatchObject({ status: 'final', paid: 0, tds: 0, balance: 500, payment_status: 'unpaid' });
    expect(await balanceOf('suppliers', SUPP)).toBeCloseTo(suppBefore, 2);
    const tdsAfter = (
      await pool.query(`SELECT status, cancelled_by, cancellation_reason FROM tds_transactions WHERE id = $1`, [tdsRow[0].id])
    ).rows[0];
    expect(tdsAfter).toMatchObject({ status: 'cancelled', cancelled_by: A });
    expect(tdsAfter.cancellation_reason).toMatch(/Paid the wrong bill/);

    // Reversal does not cancel the bill; a separate cancel now succeeds and leaves the payment voucher alone.
    const linksBefore = (await voucherLines(pay.id)).length;
    await tx((c) =>
      cancelFinalPurchase(c, { businessId: B, purchaseId: pur, userId: A, reason: 'Wrong bill', warehouseModeEnabled: false })
    );
    expect((await purchaseRow(pur)).status).toBe('cancelled');
    expect((await voucherLines(pay.id)).length).toBe(linksBefore);
  });

  test('purchase cancel is still refused while an active payment exists', async () => {
    const pur = await makePurchase(300);
    await supplierPayment(100, { reference_type: 'purchase', reference_id: pur, supplier_id: undefined });
    await expect(
      tx((c) => cancelFinalPurchase(c, { businessId: B, purchaseId: pur, userId: A, reason: 'x', warehouseModeEnabled: false }))
    ).rejects.toMatchObject({ code: 'PURCHASE_HAS_PAYMENTS' });
  });

  test('payment against a cancelled invoice: customer credit removed, invoice totals and cancelled state unchanged', async () => {
    const inv = await makeInvoice(300);
    const custStart = await balanceOf('customers', CUST);
    const pay = await receipt(120, { reference_type: 'invoice', reference_id: inv, customer_id: undefined });
    await tx((c) => cancelPostedInvoiceInTransaction(c, { invoiceId: inv, businessId: B, userId: A, reason: 'Wrong buyer' }));
    const invCancelled = await invoiceRow(inv);
    expect(invCancelled).toMatchObject({ status: 'cancelled', grand: 300, paid: 120, balance: 0 });
    const custAfterCancel = await balanceOf('customers', CUST);
    expect(custAfterCancel).toBeCloseTo(custStart - 120 - 300, 2);

    const res = await rev(pay.id, 'Refund handled outside');
    expect(res.status).toBe(201);
    expect(res.json.reversal.document_effect).toBe('cancelled_invoice_credit');
    expectMirrored(await voucherLines(pay.id), TODAY);
    expect(await invoiceRow(inv)).toEqual(invCancelled);
    expect(await balanceOf('customers', CUST)).toBeCloseTo(custAfterCancel + 120, 2);
  });

  test('reverse first, then cancel the invoice: payment voucher is not reversed twice', async () => {
    const inv = await makeInvoice(200);
    const custStart = await balanceOf('customers', CUST);
    const pay = await receipt(80, { reference_type: 'invoice', reference_id: inv, customer_id: undefined });
    expect((await rev(pay.id)).status).toBe(201);
    const afterReversal = await voucherLines(pay.id);
    expect(await invoiceRow(inv)).toMatchObject({ paid: 0, balance: 200 });

    await tx((c) => cancelPostedInvoiceInTransaction(c, { invoiceId: inv, businessId: B, userId: A, reason: 'Wrong buyer' }));
    expect(await voucherLines(pay.id)).toEqual(afterReversal);
    expect(await balanceOf('customers', CUST)).toBeCloseTo(custStart - 200, 2);

    const again = await rev(pay.id);
    expect({ status: again.status, code: again.json.code }).toEqual({ status: 409, code: 'PAYMENT_ALREADY_REVERSED' });
  });

  test('on-account receipt and on-account supplier payment reverse whole, restoring the party balance', async () => {
    const custBefore = await balanceOf('customers', CUST);
    const suppBefore = await balanceOf('suppliers', SUPP);
    const inPay = await receipt(75);
    const outPay = await supplierPayment(60);
    const r1 = await rev(inPay.id);
    const r2 = await rev(outPay.id);
    expect([r1.status, r2.status]).toEqual([201, 201]);
    expect(r1.json.reversal.document_effect).toBe('on_account');
    expect(r2.json.reversal.document_effect).toBe('on_account');
    expectMirrored(await voucherLines(inPay.id), TODAY);
    expectMirrored(await voucherLines(outPay.id), TODAY);
    expect(await balanceOf('customers', CUST)).toBeCloseTo(custBefore, 2);
    expect(await balanceOf('suppliers', SUPP)).toBeCloseTo(suppBefore, 2);
  });

  describe('rejections leave payments, ledger, documents, balances, TDS and keys untouched', () => {
    async function expectRejected(
      run: () => Promise<{ status: number; json: any }>,
      status: number,
      code: string,
      k?: string
    ) {
      const before = await snapshot();
      const res = await run();
      expect({ status: res.status, code: res.json.code }).toEqual({ status, code });
      expect(JSON.stringify(res.json)).not.toMatch(/violates|constraint|relation|syntax|duplicate key/i);
      expect(await snapshot()).toEqual(before);
      if (k) expect(await reversalKeyRow(k)).toBeUndefined();
      return res;
    }

    test('deposited supplier TDS blocks the reversal', async () => {
      const pur = await makePurchase(400);
      const pay = await supplierPayment(380, {
        reference_type: 'purchase',
        reference_id: pur,
        tds_amount: 20,
        tds_section: '194C',
        supplier_id: undefined,
      });
      await pool.query(`UPDATE tds_transactions SET is_deposited = true WHERE payment_id = $1`, [pay.id]);
      const k = key();
      await expectRejected(() => rev(pay.id, 'x', k), 409, 'PAYMENT_TDS_DEPOSITED', k);
    });

    test('voucher-less walk-in invoice payment is refused with a document-correction message', async () => {
      const inv = await makeInvoice(50, null as unknown as string);
      const payId = randomUUID();
      await pool.query(
        `INSERT INTO payments (id, business_id, branch_id, type, customer_id, reference_type, reference_id, amount, payment_mode, payment_date, created_by)
         VALUES ($1, $2, $3, 'receivable', NULL, 'invoice', $4, 50, 'cash', $5, $6)`,
        [payId, B, BR, inv, PAY_DATE, A]
      );
      const k = key();
      const res = await expectRejected(() => rev(payId, 'x', k), 409, 'PAYMENT_HAS_NO_VOUCHER', k);
      expect(res.json.error).toMatch(/invoice/i);
    });

    test('voucher-less fully-paid purchase payment is refused with a document-correction message', async () => {
      const pur = await makePurchase(90);
      const payId = randomUUID();
      await pool.query(
        `INSERT INTO payments (id, business_id, branch_id, type, supplier_id, reference_type, reference_id, amount, payment_mode, payment_date, created_by)
         VALUES ($1, $2, $3, 'payable', $4, 'purchase', $5, 90, 'cash', $6, $7)`,
        [payId, B, BR, SUPP, pur, PAY_DATE, A]
      );
      const k = key();
      const res = await expectRejected(() => rev(payId, 'x', k), 409, 'PAYMENT_HAS_NO_VOUCHER', k);
      expect(res.json.error).toMatch(/bill/i);
    });

    test('store-linked payment is refused', async () => {
      const pay = await receipt(236);
      await pool.query(
        `INSERT INTO store_orders
           (id, business_id, branch_id, order_number, customer_name, customer_phone,
            status, payment_status, subtotal, tax_total, delivery_charge, discount_amount, grand_total, delivery_mode, receipt_payment_id)
         VALUES ($1, $2, $3, $4, 'Buyer', $5, 'confirmed', 'paid', 200, 36, 0, 0, 236, 'pickup', $6)`,
        [randomUUID(), B, BR, `P44-${tag}-${pay.id.slice(0, 4)}`, `97${Date.now().toString().slice(-8)}`, pay.id]
      );
      const k = key();
      await expectRejected(() => rev(pay.id, 'x', k), 409, 'PAYMENT_STORE_LINKED', k);
    });

    test('deleted and already-reversed payments are refused', async () => {
      const deleted = await receipt(11);
      await pool.query(`UPDATE payments SET deleted_at = NOW() WHERE id = $1`, [deleted.id]);
      await expectRejected(() => rev(deleted.id), 409, 'PAYMENT_DELETED');

      const once = await receipt(12);
      expect((await rev(once.id)).status).toBe(201);
      const k = key();
      await expectRejected(() => rev(once.id, 'second try', k), 409, 'PAYMENT_ALREADY_REVERSED', k);
    });

    test('missing reason, missing or invalid key are rejected before authorization', async () => {
      const pay = await receipt(13);
      authorizeMock.mockClear();
      await expectRejected(() => reverse(pay.id, { ...spoof }, { 'X-Idempotency-Key': key() }), 400, 'REVERSAL_REASON_REQUIRED');
      await expectRejected(() => reverse(pay.id, { reason: '   ' }, { 'X-Idempotency-Key': key() }), 400, 'REVERSAL_REASON_REQUIRED');
      await expectRejected(() => reverse(pay.id, { reason: 42 }, { 'X-Idempotency-Key': key() }), 400, 'REVERSAL_REASON_REQUIRED');
      await expectRejected(() => reverse(pay.id, null, { 'X-Idempotency-Key': key() }), 400, 'REVERSAL_REASON_REQUIRED');
      await expectRejected(() => reverse(pay.id, { reason: 'x' }), 400, 'IDEMPOTENCY_KEY_REQUIRED');
      await expectRejected(() => reverse(pay.id, { reason: 'x' }, { 'X-Idempotency-Key': 'has space' }), 400, 'IDEMPOTENCY_KEY_INVALID');
      expect(authorizeMock).not.toHaveBeenCalled();
    });

    test('missing payments:reverse permission returns 403', async () => {
      const pay = await receipt(14);
      authorizeMock.mockReset();
      authorizeMock.mockRejectedValue(new AuthorizationError('Missing payment_reversals.create', 'FORBIDDEN'));
      const k = key();
      await expectRejected(() => rev(pay.id, 'x', k), 403, 'FORBIDDEN', k);
      expect(authorizeMock).toHaveBeenCalledWith(A, 'payment_reversals', 'create', { businessId: B, branchId: BR });
    });

    test('client identity cannot authorize: a body/header user other than the session is ignored', async () => {
      const pay = await receipt(15);
      authorizeMock.mockReset();
      authorizeMock.mockImplementation(async (userId: string) => {
        if (userId !== OTHER) throw new AuthorizationError('Not allowed', 'FORBIDDEN');
      });
      await expectRejected(() => rev(pay.id), 403, 'FORBIDDEN');
      expect(authorizeMock.mock.calls.map((c) => c[0])).toEqual([A]);
    });

    test('unauthenticated request is rejected', async () => {
      const pay = await receipt(16);
      const res = await call(
        reversePayment(
          new NextRequest(`http://localhost/api/payments/${pay.id}/reverse`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-user-id': A, 'X-Idempotency-Key': key() },
            body: JSON.stringify({ reason: 'x', user_id: A, business_id: B }),
          }),
          { params: { id: pay.id } }
        )
      );
      expect({ status: res.status, code: res.json.code }).toEqual({ status: 401, code: 'UNAUTHENTICATED' });
    });

    test('another business payment id, an unknown id and a malformed id return 404', async () => {
      const foreignPay = randomUUID();
      await pool.query(
        `INSERT INTO payments (id, business_id, branch_id, type, customer_id, amount, payment_mode, payment_date)
         VALUES ($1, $2, $3, 'receivable', $4, 10, 'cash', $5)`,
        [foreignPay, B2, BR2, FOREIGN_CUST, PAY_DATE]
      );
      await expectRejected(() => rev(foreignPay), 404, 'PAYMENT_NOT_FOUND');
      await expectRejected(() => rev(randomUUID()), 404, 'PAYMENT_NOT_FOUND');
      await expectRejected(() => rev('not-a-uuid'), 404, 'PAYMENT_NOT_FOUND');
    });

    test('locked current period and filed GST period are rejected before any write; a revised period is allowed', async () => {
      const pay = await receipt(17);
      await pool.query(
        `INSERT INTO period_locks (business_id, branch_id, financial_year, period_start, period_end, is_locked, locked_by)
         VALUES ($1, NULL, '2026-27', CURRENT_DATE, CURRENT_DATE, true, $2)`,
        [B, A]
      );
      const k1 = key();
      await expectRejected(() => rev(pay.id, 'x', k1), 403, 'PERIOD_LOCKED', k1);
      await pool.query(`DELETE FROM period_locks WHERE business_id = $1`, [B]);

      await pool.query(
        `INSERT INTO gst_filings (business_id, branch_id, gst_period, status, filed_at) VALUES ($1, NULL, $2, 'filed', NOW())`,
        [B, TODAY.slice(0, 7)]
      );
      const k2 = key();
      await expectRejected(() => rev(pay.id, 'x', k2), 403, 'GST_PERIOD_FILED', k2);

      await pool.query(`UPDATE gst_filings SET status = 'revised' WHERE business_id = $1`, [B]);
      expect((await rev(pay.id)).status).toBe(201);
    });

    test('a failure inside the transaction rolls everything back and hides the database error', async () => {
      const inv = await makeInvoice(70);
      const pay = await receipt(70, { reference_type: 'invoice', reference_id: inv, customer_id: undefined });
      jest.spyOn(invoiceBalance, 'recomputeInvoiceBalance').mockRejectedValueOnce(
        Object.assign(new Error('duplicate key value violates unique constraint "x"'), { code: '23505' })
      );
      jest.spyOn(console, 'error').mockImplementation(() => {});
      const k = key();
      const res = await expectRejected(() => rev(pay.id, 'x', k), 500, 'PAYMENT_REVERSAL_FAILED', k);
      expect(res.json.error).toBe('Failed to reverse payment');
      jest.restoreAllMocks();
      authorizeMock.mockImplementation(async () => undefined);
      expect((await rev(pay.id, 'x', k)).status).toBe(201);
    });
  });

  test('reversal is dated today even when the payment date is locked and GST-filed', async () => {
    const pay = await receipt(18);
    await pool.query(
      `INSERT INTO period_locks (business_id, branch_id, financial_year, period_start, period_end, is_locked, locked_by)
       VALUES ($1, NULL, '2026-27', $2, $2, true, $3)`,
      [B, PAY_DATE, A]
    );
    await pool.query(
      `INSERT INTO gst_filings (business_id, branch_id, gst_period, status, filed_at) VALUES ($1, NULL, $2, 'filed', NOW())`,
      [B, PAY_DATE.slice(0, 7)]
    );
    const res = await rev(pay.id);
    expect(res.status).toBe(201);
    expect(res.json.reversal.reversal_date).toBe(TODAY);
    const lines = await voucherLines(pay.id);
    expectMirrored(lines, TODAY);
    expect(lines.filter((l) => !l.reverses).every((l) => l.entry_date === PAY_DATE)).toBe(true);
  });

  test('concurrent reversals with different keys produce exactly one reversal', async () => {
    const custBefore = await balanceOf('customers', CUST);
    const pay = await receipt(33);
    const results = await Promise.all(Array.from({ length: 4 }, () => rev(pay.id)));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409).map((r) => r.json.code)).toEqual(
      Array(3).fill('PAYMENT_ALREADY_REVERSED')
    );
    const count = (await pool.query(`SELECT COUNT(*)::int AS n FROM payment_reversals WHERE payment_id = $1`, [pay.id])).rows[0].n;
    expect(count).toBe(1);
    expectMirrored(await voucherLines(pay.id), TODAY);
    expect(await balanceOf('customers', CUST)).toBeCloseTo(custBefore, 2);
  });

  test('concurrent reversals with one key produce one reversal and replay it to the others', async () => {
    const pay = await receipt(34);
    const k = key();
    const results = await Promise.all(Array.from({ length: 4 }, () => rev(pay.id, 'Same request', k)));
    expect(results.map((r) => r.status)).toEqual([201, 201, 201, 201]);
    expect(new Set(results.map((r) => r.json.reversal.id)).size).toBe(1);
    expect(results.filter((r) => r.replayed === 'true')).toHaveLength(3);
    expectMirrored(await voucherLines(pay.id), TODAY);
  });

  test('same key and same request replays; a different request with that key conflicts', async () => {
    const pay = await receipt(35);
    const other = await receipt(36);
    const k = key();
    const first = await rev(pay.id, 'Duplicate receipt', k);
    expect(first.status).toBe(201);
    const afterFirst = await snapshot();
    expect(await reversalKeyRow(k)).toMatchObject({
      status: 'completed',
      action_type: 'payments.reverse',
      entity_type: 'payment_reversal',
      entity_id: first.json.reversal.id,
      request_payload: { payment_id: pay.id },
    });

    const retry = await rev(pay.id, ' Duplicate receipt ', k);
    expect(retry.status).toBe(201);
    expect(retry.replayed).toBe('true');
    expect(retry.json).toEqual(first.json);
    expect(await snapshot()).toEqual(afterFirst);

    await pool.query(
      `INSERT INTO period_locks (business_id, branch_id, financial_year, period_start, period_end, is_locked, locked_by)
       VALUES ($1, NULL, '2026-27', CURRENT_DATE, CURRENT_DATE, true, $2)`,
      [B, A]
    );
    const lockedRetry = await rev(pay.id, 'Duplicate receipt', k);
    expect(lockedRetry.status).toBe(201);
    expect(lockedRetry.json.reversal.id).toBe(first.json.reversal.id);
    await pool.query(`DELETE FROM period_locks WHERE business_id = $1`, [B]);

    for (const [id, reason] of [
      [pay.id, 'Different reason'],
      [other.id, 'Duplicate receipt'],
    ]) {
      const res = await rev(id, reason, k);
      expect({ status: res.status, code: res.json.code }).toEqual({ status: 409, code: 'IDEMPOTENCY_KEY_REUSED' });
    }
    expect(await snapshot()).toEqual(afterFirst);
    expect((await pool.query(`SELECT status FROM payments WHERE id = $1`, [other.id])).rows[0].status).toBe('active');
  });

  test('replaying the original create key after reversal returns the reversed payment and creates nothing', async () => {
    const createKey = `pay-${randomUUID()}`;
    const body = { type: 'receivable', customer_id: CUST, amount: 44, notes: 'Counter' };
    const created = await createPayment(body, createKey);
    expect(created.status).toBe(201);
    expect(created.json.payment.status).toBe('active');
    expect((await rev(created.json.payment.id)).status).toBe(201);
    const before = await snapshot();

    const replay = await createPayment(body, createKey);
    expect(replay.status).toBe(201);
    expect(replay.replayed).toBe('true');
    expect(replay.json.payment).toMatchObject({ id: created.json.payment.id, status: 'reversed' });
    expect(replay.json.payment.reversal_id).toBeTruthy();
    expect(await snapshot()).toEqual(before);
  });

  test('database guards: a reversed payment cannot be re-activated, nor marked reversed without a record', async () => {
    const pay = await receipt(19);
    await expect(
      pool.query(
        `UPDATE payments SET status = 'reversed', reversed_at = NOW(), reversal_reason = 'x', reversal_id = $2 WHERE id = $1`,
        [pay.id, randomUUID()]
      )
    ).rejects.toMatchObject({ hint: 'PAYMENT_REVERSAL_RECORD_REQUIRED' });
    const res = await rev(pay.id);
    expect(res.status).toBe(201);
    await expect(
      pool.query(
        `UPDATE payments SET status = 'active', reversed_at = NULL, reversal_reason = NULL, reversal_id = NULL, reversed_by = NULL WHERE id = $1`,
        [pay.id]
      )
    ).rejects.toMatchObject({ hint: 'PAYMENT_REVERSED_IMMUTABLE' });
    await expect(pool.query(`UPDATE payments SET amount = 1 WHERE id = $1`, [pay.id])).rejects.toMatchObject({
      hint: 'PAYMENT_REVERSED_IMMUTABLE',
    });
    await expect(pool.query(`UPDATE payment_reversals SET reason = 'edited' WHERE id = $1`, [res.json.reversal.id])).rejects.toThrow(
      /cannot be changed/
    );
  });

  test('reports exclude reversed payments from active totals and show the reversal in the party ledger', async () => {
    const inv = await makeInvoice(500, CUST_REPORT);
    await pool.query(`UPDATE customers SET current_balance = current_balance + 500 WHERE id = $1`, [CUST_REPORT]);
    const pay = await receipt(200, { reference_type: 'invoice', reference_id: inv, customer_id: undefined });

    const reportReq = (p: string) =>
      new NextRequest(`http://localhost${p}`, {
        headers: { 'x-authenticated-user-id': A, 'x-authenticated-business-id': B },
      });
    const fy = Number(PAY_DATE.slice(5, 7)) >= 4 ? Number(PAY_DATE.slice(0, 4)) : Number(PAY_DATE.slice(0, 4)) - 1;
    const incoming = async () => {
      const res = await call(cashFlow(reportReq(`/api/dashboard/cash-flow?fiscal_year=${fy}`)));
      expect(res.status).toBe(200);
      return Number(res.json.months.find((m: any) => m.month === PAY_DATE.slice(0, 7))?.incoming ?? 0);
    };
    const outstanding = async () => {
      const res = await call(
        agingReceivables(reportReq(`/api/reports/aging/receivables?customer_id=${CUST_REPORT}&as_on_date=${TODAY}`))
      );
      expect(res.status).toBe(200);
      return Number(res.json.aging.find((a: any) => a.customer_id === CUST_REPORT)?.total_outstanding ?? 0);
    };

    const incomingBefore = await incoming();
    expect(await outstanding()).toBeCloseTo(300, 2);

    expect((await rev(pay.id, 'Bounced cheque')).status).toBe(201);

    expect(await incoming()).toBeCloseTo(incomingBefore - 200, 2);
    expect(await outstanding()).toBeCloseTo(500, 2);

    const ledger = await call(
      partyLedger(reportReq(`/api/reports/party/ledger?party_type=customer&party_id=${CUST_REPORT}`))
    );
    expect(ledger.status).toBe(200);
    const rows = ledger.json.transactions as any[];
    const original = rows.find((r) => r.transaction_type === 'payment' && r.id === pay.id);
    const reversalRow = rows.find((r) => r.transaction_type === 'payment_reversal' && r.payment_id === pay.id);
    expect(original).toMatchObject({ payment_status: 'reversed' });
    expect(original.description).toMatch(/reversed/);
    expect(Number(original.credit)).toBe(200);
    expect(reversalRow).toBeDefined();
    expect(Number(reversalRow.debit)).toBe(200);
    expect(ledger.json.closing_balance).toBeCloseTo(500, 2);
  });
});
