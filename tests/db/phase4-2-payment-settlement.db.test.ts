/**
 * Phase 4.2: payment type must match the document, an on-account party must
 * belong to the session business, and a walk-in invoice cannot take a separate receipt.
 * Runs only when PHASE2_TEST_DATABASE_URL points at a disposable database.
 */
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
  authorize: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/lib/enforce-access', () => ({
  ...jest.requireActual('@/lib/enforce-access'),
  enforceAccess: jest.fn().mockResolvedValue(undefined),
  enforceAccessErrorResponse: jest.fn(() => null),
}));
jest.mock('@/lib/subscription/feature-access', () => ({
  ...jest.requireActual('@/lib/subscription/feature-access'),
  assertFeatureAccess: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/lib/activity-logger', () => ({
  logActivity: jest.fn().mockResolvedValue(undefined),
  getClientIP: jest.fn(() => '127.0.0.1'),
  getUserAgent: jest.fn(() => 'jest'),
}));

import { getPool, closePool } from '@/lib/db';
import { withLedgerDelete } from '@/lib/accounting/ledger-delete-guard';
import { POST as postPayment } from '@/app/api/payments/route';
import { PATCH as patchInvoicePayment } from '@/app/api/invoices/[id]/payments/route';

d('Phase 4.2 mismatched and cross-tenant payments (real DB)', () => {
  jest.setTimeout(120000);

  let pool: Pool;
  const B = randomUUID();
  const B2 = randomUUID();
  const BR = randomUUID();
  const A = randomUUID();
  const OTHER = randomUUID();
  const CUST = randomUUID();
  const SUPP = randomUUID();
  const FOREIGN_CUST = randomUUID();
  const FOREIGN_SUPP = randomUUID();
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

  const req = (body: unknown) =>
    new NextRequest(`http://localhost/api/payments?user_id=${OTHER}&business_id=${B2}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-user-id': OTHER,
        'x-authenticated-user-id': A,
        'x-authenticated-business-id': B,
      },
      body: JSON.stringify(body),
    });

  const call = async (res: Response | Promise<Response>) => {
    const r = await res;
    const json = await r.json().catch(() => ({}));
    return { status: r.status, json: json as any };
  };

  const spoof = { user_id: OTHER, created_by: OTHER, business_id: B2 };

  async function counts() {
    const row = (
      await pool.query(
        `SELECT
           (SELECT COUNT(*)::int FROM payments WHERE business_id = ANY($1::uuid[])) AS payments,
           (SELECT COUNT(*)::int FROM ledger_entry_lines WHERE business_id = ANY($1::uuid[])) AS lines,
           (SELECT current_balance::float8 FROM customers WHERE id = $2) AS cust,
           (SELECT current_balance::float8 FROM suppliers WHERE id = $3) AS supp,
           (SELECT current_balance::float8 FROM customers WHERE id = $4) AS foreign_cust,
           (SELECT current_balance::float8 FROM suppliers WHERE id = $5) AS foreign_supp`,
        [[B, B2], CUST, SUPP, FOREIGN_CUST, FOREIGN_SUPP]
      )
    ).rows[0];
    return row as {
      payments: number;
      lines: number;
      cust: number;
      supp: number;
      foreign_cust: number;
      foreign_supp: number;
    };
  }

  async function docPaid(table: 'invoices' | 'purchases', id: string) {
    const row = (
      await pool.query(`SELECT paid_amount::float8 AS paid FROM ${table} WHERE id = $1`, [id])
    ).rows[0];
    return Number(row.paid);
  }

  async function makeInvoice(customerId: string | null, grand = 1000) {
    const id = randomUUID();
    await pool.query(
      `INSERT INTO invoices (id, business_id, customer_id, invoice_number, invoice_date, status, document_type,
          place_of_supply_state_code, subtotal, tax_total, cgst_total, sgst_total, igst_total, grand_total,
          paid_amount, balance_amount, payment_status, branch_id)
       VALUES ($1, $2, $3, $4, '2026-09-20', 'final', 'tax_invoice', '27', $5, 0, 0, 0, 0, $5, 0, $5, 'unpaid', $6)`,
      [id, B, customerId, `INV-${tag}-${id.slice(0, 4)}`, grand, BR]
    );
    return id;
  }

  async function makePurchase(grand = 800) {
    const id = randomUUID();
    await pool.query(
      `INSERT INTO purchases (id, business_id, supplier_id, bill_number, bill_date, status, place_of_supply_state_code,
          is_reverse_charge, itc_eligible, subtotal, tax_total, cgst_total, sgst_total, igst_total, grand_total,
          paid_amount, balance_amount, payment_status, branch_id)
       VALUES ($1, $2, $3, $4, '2026-09-20', 'final', '27', false, true, $5, 0, 0, 0, 0, $5, 0, $5, 'unpaid', $6)`,
      [id, B, SUPP, `PB-${tag}-${id.slice(0, 4)}`, grand, BR]
    );
    return id;
  }

  async function voucher(paymentId: string) {
    return (
      await pool.query<{ code: string; dr: number; cr: number }>(
        `SELECT a.account_code AS code, SUM(l.debit)::float8 AS dr, SUM(l.credit)::float8 AS cr
           FROM ledger_entry_lines l
           JOIN accounts a ON a.id = l.account_id
          WHERE l.business_id = $1 AND l.voucher_type = 'payment' AND l.voucher_id = $2
          GROUP BY a.account_code
          ORDER BY a.account_code`,
        [B, paymentId]
      )
    ).rows;
  }

  beforeAll(async () => {
    pool = getPool();
    const gstA = `27AABCU${tag.slice(0, 4).toUpperCase()}C1Z5`;
    const gstB = `29AABCU${tag.slice(0, 4).toUpperCase()}D1Z5`;
    await pool.query(
      `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type)
       VALUES ($1, $2, $3, '27', 'regular'), ($4, $5, $6, '29', 'regular')`,
      [B, `Phase42 ${tag}`, gstA, B2, `Phase42b ${tag}`, gstB]
    );
    await pool.query(
      `INSERT INTO branches (id, business_id, name, state_code, is_primary, is_default, is_active)
       VALUES ($1, $2, 'Main', '27', true, true, true)`,
      [BR, B]
    );
    const phone = Date.now().toString().slice(-8);
    await pool.query(
      `INSERT INTO users (id, business_id, name, phone, is_primary_admin)
       VALUES ($1, $2, 'Clerk', $3, true), ($4, $2, 'Other', $5, false)`,
      [A, B, `91${phone}`, OTHER, `92${phone}`]
    );
    await pool.query(`SELECT create_default_chart_of_accounts($1)`, [B]);
    await pool.query(`SELECT ensure_standard_account_heads($1)`, [B]);
    await pool.query(`SELECT create_default_chart_of_accounts($1)`, [B2]);
    await pool.query(`SELECT ensure_standard_account_heads($1)`, [B2]);
    await pool.query(
      `INSERT INTO customers (id, business_id, name, state_code, current_balance)
       VALUES ($1, $2, 'Asha', '27', 1000), ($3, $4, 'Foreign', '29', 50)`,
      [CUST, B, FOREIGN_CUST, B2]
    );
    await pool.query(
      `INSERT INTO suppliers (id, business_id, name, state_code, current_balance)
       VALUES ($1, $2, 'Bharat', '27', 800), ($3, $4, 'Foreign Sup', '29', 40)`,
      [SUPP, B, FOREIGN_SUPP, B2]
    );
  });

  afterAll(async () => {
    if (!pool) return;
    try {
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
    await pool.query(`UPDATE customers SET current_balance = 1000 WHERE id = $1`, [CUST]);
    await pool.query(`UPDATE suppliers SET current_balance = 800 WHERE id = $1`, [SUPP]);
    await pool.query(`UPDATE customers SET current_balance = 50 WHERE id = $1`, [FOREIGN_CUST]);
    await pool.query(`UPDATE suppliers SET current_balance = 40 WHERE id = $1`, [FOREIGN_SUPP]);
  });

  test('receivable payment against a final invoice posts one balanced voucher', async () => {
    const inv = await makeInvoice(CUST, 1000);
    const before = await counts();
    const res = await call(
      postPayment(
        req({
          ...spoof,
          type: 'receivable',
          customer_id: FOREIGN_CUST,
          reference_type: 'invoice',
          reference_id: inv,
          amount: 200,
          payment_mode: 'cash',
          payment_date: '2026-09-20',
        })
      )
    );
    expect(res.status).toBe(201);
    const pay = (
      await pool.query(
        `SELECT id, type, customer_id, supplier_id, amount::float8 AS amount, created_by, business_id
           FROM payments WHERE reference_id = $1 AND deleted_at IS NULL`,
        [inv]
      )
    ).rows;
    expect(pay).toEqual([
      {
        id: expect.any(String),
        type: 'receivable',
        customer_id: CUST,
        supplier_id: null,
        amount: 200,
        created_by: A,
        business_id: B,
      },
    ]);
    expect(await docPaid('invoices', inv)).toBe(200);
    const after = await counts();
    expect(after.payments).toBe(before.payments + 1);
    expect(after.lines).toBe(before.lines + 2);
    expect(after.cust).toBe(800);
    expect(after.foreign_cust).toBe(50);
    const lines = await voucher(pay[0].id);
    expect(lines).toEqual([
      { code: '1101', dr: 200, cr: 0 },
      { code: '1103', dr: 0, cr: 200 },
    ]);
  });

  test('payable payment against a final purchase posts one balanced voucher', async () => {
    const pur = await makePurchase(800);
    const before = await counts();
    const res = await call(
      postPayment(
        req({
          ...spoof,
          type: 'payable',
          supplier_id: FOREIGN_SUPP,
          reference_type: 'purchase',
          reference_id: pur,
          amount: 150,
          payment_mode: 'cash',
          payment_date: '2026-09-20',
        })
      )
    );
    expect(res.status).toBe(201);
    const pay = (
      await pool.query(
        `SELECT id, type, customer_id, supplier_id, amount::float8 AS amount, created_by, business_id
           FROM payments WHERE reference_id = $1 AND deleted_at IS NULL`,
        [pur]
      )
    ).rows;
    expect(pay).toEqual([
      {
        id: expect.any(String),
        type: 'payable',
        customer_id: null,
        supplier_id: SUPP,
        amount: 150,
        created_by: A,
        business_id: B,
      },
    ]);
    expect(await docPaid('purchases', pur)).toBe(150);
    const after = await counts();
    expect(after.payments).toBe(before.payments + 1);
    expect(after.lines).toBe(before.lines + 2);
    expect(after.supp).toBe(650);
    expect(after.foreign_supp).toBe(40);
    expect(await voucher(pay[0].id)).toEqual([
      { code: '1101', dr: 0, cr: 150 },
      { code: '2101', dr: 150, cr: 0 },
    ]);
  });

  test('receivable against a purchase is rejected with no side effects', async () => {
    const pur = await makePurchase(800);
    const before = await counts();
    const res = await call(
      postPayment(
        req({
          ...spoof,
          type: 'receivable',
          reference_type: 'purchase',
          reference_id: pur,
          amount: 100,
          payment_mode: 'cash',
          payment_date: '2026-09-20',
        })
      )
    );
    expect(res.status).toBe(400);
    expect(res.json.code).toBe('PAYMENT_TYPE_DOCUMENT_MISMATCH');
    expect(await docPaid('purchases', pur)).toBe(0);
    expect(await counts()).toEqual(before);
  });

  test('payable against an invoice is rejected with no side effects', async () => {
    const inv = await makeInvoice(CUST, 1000);
    const before = await counts();
    const res = await call(
      postPayment(
        req({
          ...spoof,
          type: 'payable',
          reference_type: 'invoice',
          reference_id: inv,
          amount: 100,
          payment_mode: 'cash',
          payment_date: '2026-09-20',
        })
      )
    );
    expect(res.status).toBe(400);
    expect(res.json.code).toBe('PAYMENT_TYPE_DOCUMENT_MISMATCH');
    expect(await docPaid('invoices', inv)).toBe(0);
    expect(await counts()).toEqual(before);
  });

  test('on-account receipt for a same-business customer posts the receipt voucher', async () => {
    const before = await counts();
    const res = await call(
      postPayment(
        req({
          ...spoof,
          type: 'receivable',
          customer_id: CUST,
          amount: 75,
          payment_mode: 'cash',
          payment_date: '2026-09-20',
        })
      )
    );
    expect(res.status).toBe(201);
    const pay = (
      await pool.query(
        `SELECT id, reference_type, reference_id, customer_id, business_id, created_by, amount::float8 AS amount
           FROM payments
          WHERE business_id = $1 AND customer_id = $2 AND reference_id IS NULL AND deleted_at IS NULL
          ORDER BY created_at DESC LIMIT 1`,
        [B, CUST]
      )
    ).rows[0];
    expect(pay).toMatchObject({
      reference_type: null,
      reference_id: null,
      customer_id: CUST,
      business_id: B,
      created_by: A,
      amount: 75,
    });
    const after = await counts();
    expect(after.payments).toBe(before.payments + 1);
    expect(after.lines).toBe(before.lines + 2);
    expect(after.cust).toBe(925);
    expect(await voucher(pay.id)).toEqual([
      { code: '1101', dr: 75, cr: 0 },
      { code: '1103', dr: 0, cr: 75 },
    ]);
  });

  test('on-account payment for a same-business supplier posts the payment voucher', async () => {
    const before = await counts();
    const res = await call(
      postPayment(
        req({
          ...spoof,
          type: 'payable',
          supplier_id: SUPP,
          amount: 60,
          payment_mode: 'cash',
          payment_date: '2026-09-20',
        })
      )
    );
    expect(res.status).toBe(201);
    const pay = (
      await pool.query(
        `SELECT id, reference_id, supplier_id, customer_id, business_id, amount::float8 AS amount
           FROM payments
          WHERE business_id = $1 AND supplier_id = $2 AND reference_id IS NULL AND deleted_at IS NULL
          ORDER BY created_at DESC LIMIT 1`,
        [B, SUPP]
      )
    ).rows[0];
    expect(pay).toMatchObject({
      reference_id: null,
      supplier_id: SUPP,
      customer_id: null,
      business_id: B,
      amount: 60,
    });
    const after = await counts();
    expect(after.payments).toBe(before.payments + 1);
    expect(after.lines).toBe(before.lines + 2);
    expect(after.supp).toBe(740);
    expect(await voucher(pay.id)).toEqual([
      { code: '1101', dr: 0, cr: 60 },
      { code: '2101', dr: 60, cr: 0 },
    ]);
  });

  test('cross-business customer id is rejected with no payment row or ledger lines', async () => {
    const before = await counts();
    const res = await call(
      postPayment(
        req({
          ...spoof,
          type: 'receivable',
          customer_id: FOREIGN_CUST,
          amount: 25,
          payment_mode: 'cash',
          payment_date: '2026-09-20',
        })
      )
    );
    expect(res.status).toBe(404);
    expect(res.json.code).toBe('PAYMENT_PARTY_NOT_FOUND');
    expect(await counts()).toEqual(before);
    expect(
      Number(
        (
          await pool.query(`SELECT COUNT(*)::int AS n FROM payments WHERE customer_id = $1`, [FOREIGN_CUST])
        ).rows[0].n
      )
    ).toBe(0);
  });

  test('cross-business supplier id is rejected with no payment row or ledger lines', async () => {
    const before = await counts();
    const res = await call(
      postPayment(
        req({
          ...spoof,
          type: 'payable',
          supplier_id: FOREIGN_SUPP,
          amount: 25,
          payment_mode: 'cash',
          payment_date: '2026-09-20',
        })
      )
    );
    expect(res.status).toBe(404);
    expect(res.json.code).toBe('PAYMENT_PARTY_NOT_FOUND');
    expect(await counts()).toEqual(before);
    expect(
      Number(
        (
          await pool.query(`SELECT COUNT(*)::int AS n FROM payments WHERE supplier_id = $1`, [FOREIGN_SUPP])
        ).rows[0].n
      )
    ).toBe(0);
  });

  test('missing or invalid on-account party is rejected with no side effects', async () => {
    const before = await counts();
    const missing = await call(
      postPayment(req({ ...spoof, type: 'receivable', amount: 10, payment_mode: 'cash', payment_date: '2026-09-20' }))
    );
    const invalid = await call(
      postPayment(
        req({
          ...spoof,
          type: 'payable',
          supplier_id: 'not-a-supplier',
          amount: 10,
          payment_mode: 'cash',
          payment_date: '2026-09-20',
        })
      )
    );
    const unknown = await call(
      postPayment(
        req({
          ...spoof,
          type: 'receivable',
          customer_id: randomUUID(),
          amount: 10,
          payment_mode: 'cash',
          payment_date: '2026-09-20',
        })
      )
    );
    const both = await call(
      postPayment(
        req({
          ...spoof,
          type: 'receivable',
          customer_id: CUST,
          supplier_id: SUPP,
          amount: 10,
          payment_mode: 'cash',
          payment_date: '2026-09-20',
        })
      )
    );
    const badRef = await call(
      postPayment(
        req({
          ...spoof,
          type: 'receivable',
          customer_id: CUST,
          reference_type: 'credit_note',
          reference_id: randomUUID(),
          amount: 10,
          payment_mode: 'cash',
        })
      )
    );
    expect(missing.status).toBe(400);
    expect(missing.json.code).toBe('PAYMENT_PARTY_INVALID');
    expect(invalid.status).toBe(400);
    expect(invalid.json.code).toBe('PAYMENT_PARTY_INVALID');
    expect(unknown.status).toBe(404);
    expect(unknown.json.code).toBe('PAYMENT_PARTY_NOT_FOUND');
    expect(both.status).toBe(400);
    expect(both.json.code).toBe('PAYMENT_PARTY_INVALID');
    expect(badRef.status).toBe(400);
    expect(badRef.json.code).toBe('PAYMENT_REFERENCE_INVALID');
    expect(await counts()).toEqual(before);
  });

  test('walk-in invoice payment cannot change paid_amount or create a payment row', async () => {
    const inv = await makeInvoice(null, 500);
    const before = await counts();
    const patched = await call(
      patchInvoicePayment(
        new NextRequest(`http://localhost/api/invoices/${inv}/payments?user_id=${OTHER}&business_id=${B2}`, {
          method: 'PATCH',
          headers: {
            'content-type': 'application/json',
            'x-user-id': OTHER,
            'x-authenticated-user-id': A,
            'x-authenticated-business-id': B,
          },
          body: JSON.stringify({ ...spoof, amount: 100, payment_mode: 'cash', payment_date: '2026-09-20' }),
        }),
        { params: { id: inv } }
      )
    );
    const posted = await call(
      postPayment(
        req({
          ...spoof,
          type: 'receivable',
          reference_type: 'invoice',
          reference_id: inv,
          amount: 100,
          payment_mode: 'cash',
          payment_date: '2026-09-20',
        })
      )
    );
    expect(patched.status).toBe(400);
    expect(patched.json.code).toBe('WALK_IN_RECEIPT_NOT_SUPPORTED');
    expect(posted.status).toBe(400);
    expect(posted.json.code).toBe('WALK_IN_RECEIPT_NOT_SUPPORTED');
    expect(await docPaid('invoices', inv)).toBe(0);
    expect(await counts()).toEqual(before);
    expect(
      Number((await pool.query(`SELECT COUNT(*)::int AS n FROM payments WHERE reference_id = $1`, [inv])).rows[0].n)
    ).toBe(0);
  });

  test('a locked accounting period rejects a valid receipt before any write', async () => {
    const today = (await pool.query(`SELECT CURRENT_DATE::text AS d`)).rows[0].d as string;
    const inv = await makeInvoice(CUST, 400);
    await pool.query(`UPDATE invoices SET invoice_date = $2 WHERE id = $1`, [inv, today]);
    const before = await counts();
    await pool.query(
      `INSERT INTO period_locks (business_id, branch_id, financial_year, period_start, period_end, is_locked, locked_by)
       VALUES ($1, NULL, '2026-27', CURRENT_DATE, CURRENT_DATE, true, $2)`,
      [B, A]
    );
    try {
      const res = await call(
        postPayment(
          req({
            ...spoof,
            type: 'receivable',
            customer_id: CUST,
            reference_type: 'invoice',
            reference_id: inv,
            amount: 40,
            payment_mode: 'cash',
            payment_date: today,
          })
        )
      );
      expect(res.status).toBe(403);
      expect(res.json.code).toBe('PERIOD_LOCKED');
      expect(await docPaid('invoices', inv)).toBe(0);
      expect(await counts()).toEqual(before);
    } finally {
      await pool.query(`DELETE FROM period_locks WHERE business_id = $1`, [B]);
    }
  });
});
