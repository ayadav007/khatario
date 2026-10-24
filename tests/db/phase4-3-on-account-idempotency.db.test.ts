/**
 * Phase 4.3: on-account payment validation and X-Idempotency-Key retry protection on POST /api/payments.
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
import * as ledgerUtils from '@/lib/ledger-utils';
import { POST as postPayment } from '@/app/api/payments/route';

d('Phase 4.3 on-account payments and idempotency (real DB)', () => {
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

  const req = (body: unknown, headers: Record<string, string> = {}) =>
    new NextRequest(`http://localhost/api/payments?user_id=${OTHER}&business_id=${B2}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-user-id': OTHER,
        'x-authenticated-user-id': A,
        'x-authenticated-business-id': B,
        ...headers,
      },
      body: JSON.stringify(body),
    });

  const call = async (res: Response | Promise<Response>) => {
    const r = await res;
    const json = await r.json().catch(() => ({}));
    return { status: r.status, json: json as any, replayed: r.headers.get('Idempotent-Replayed') };
  };

  const spoof = { user_id: OTHER, created_by: OTHER, business_id: B2 };
  const key = () => `pay-${randomUUID()}`;
  const receipt = (extra: Record<string, unknown> = {}) => ({
    ...spoof,
    type: 'receivable',
    customer_id: CUST,
    amount: 120,
    payment_mode: 'cash',
    payment_date: '2026-09-20',
    notes: 'Counter receipt',
    ...extra,
  });

  async function snapshot() {
    const row = (
      await pool.query(
        `SELECT
           (SELECT COUNT(*)::int FROM payments WHERE business_id = ANY($1::uuid[])) AS payments,
           (SELECT COUNT(*)::int FROM ledger_entry_lines WHERE business_id = ANY($1::uuid[])) AS lines,
           (SELECT COUNT(DISTINCT voucher_id)::int FROM ledger_entry_lines
             WHERE business_id = ANY($1::uuid[]) AND voucher_type = 'payment') AS vouchers,
           (SELECT COUNT(*)::int FROM offline_replay_log WHERE business_id = ANY($1::uuid[])) AS keys,
           (SELECT current_balance::float8 FROM customers WHERE id = $2) AS cust,
           (SELECT current_balance::float8 FROM suppliers WHERE id = $3) AS supp,
           (SELECT current_balance::float8 FROM customers WHERE id = $4) AS foreign_cust,
           (SELECT current_balance::float8 FROM suppliers WHERE id = $5) AS foreign_supp`,
        [[B, B2], CUST, SUPP, FOREIGN_CUST, FOREIGN_SUPP]
      )
    ).rows[0];
    return row as Record<string, number>;
  }

  async function voucher(paymentId: string) {
    return (
      await pool.query<{ code: string; dr: number; cr: number }>(
        `SELECT a.account_code AS code, SUM(l.debit)::float8 AS dr, SUM(l.credit)::float8 AS cr
           FROM ledger_entry_lines l JOIN accounts a ON a.id = l.account_id
          WHERE l.business_id = $1 AND l.voucher_type = 'payment' AND l.voucher_id = $2
          GROUP BY a.account_code ORDER BY a.account_code`,
        [B, paymentId]
      )
    ).rows;
  }

  async function voucherTotals(paymentId: string) {
    const r = (
      await pool.query(
        `SELECT COALESCE(SUM(debit), 0)::float8 AS dr, COALESCE(SUM(credit), 0)::float8 AS cr, COUNT(*)::int AS n
           FROM ledger_entry_lines WHERE business_id = $1 AND voucher_type = 'payment' AND voucher_id = $2`,
        [B, paymentId]
      )
    ).rows[0];
    return r as { dr: number; cr: number; n: number };
  }

  async function keyRow(k: string) {
    return (
      await pool.query(
        `SELECT status, action_type, request_hash, entity_id::text AS entity_id, request_payload
           FROM offline_replay_log WHERE business_id = $1 AND idempotency_key = $2`,
        [B, `payments.create:${k}`]
      )
    ).rows[0];
  }

  beforeAll(async () => {
    pool = getPool();
    const gstA = `27AABCU${tag.slice(0, 4).toUpperCase()}C1Z5`;
    const gstB = `29AABCU${tag.slice(0, 4).toUpperCase()}D1Z5`;
    await pool.query(
      `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type)
       VALUES ($1, $2, $3, '27', 'regular'), ($4, $5, $6, '29', 'regular')`,
      [B, `Phase43 ${tag}`, gstA, B2, `Phase43b ${tag}`, gstB]
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
      [A, B, `93${phone}`, OTHER, `94${phone}`]
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
    jest.restoreAllMocks();
    await pool.query(`DELETE FROM period_locks WHERE business_id = $1`, [B]);
  });

  test('1 customer on-account receipt posts one payment and one balanced voucher', async () => {
    const before = await snapshot();
    const res = await call(postPayment(req(receipt({ amount: 75 }), { 'X-Idempotency-Key': key() })));
    expect(res.status).toBe(201);
    expect(res.replayed).toBeNull();
    const p = res.json.payment;
    expect(p).toMatchObject({ business_id: B, customer_id: CUST, supplier_id: null, reference_id: null, created_by: A });
    expect(Number(p.amount)).toBe(75);
    const after = await snapshot();
    expect(after.payments).toBe(before.payments + 1);
    expect(after.vouchers).toBe(before.vouchers + 1);
    expect(after.lines).toBe(before.lines + 2);
    expect(after.keys).toBe(before.keys + 1);
    expect(after.cust).toBe(before.cust - 75);
    expect(after.foreign_cust).toBe(before.foreign_cust);
    const t = await voucherTotals(p.id);
    expect(t.dr).toBe(t.cr);
    expect(await voucher(p.id)).toEqual([
      { code: '1101', dr: 75, cr: 0 },
      { code: '1103', dr: 0, cr: 75 },
    ]);
  });

  test('2 supplier on-account payment posts one payment and one balanced voucher', async () => {
    const before = await snapshot();
    const res = await call(
      postPayment(
        req(
          { ...spoof, type: 'payable', supplier_id: SUPP, amount: 60, payment_mode: 'cash', payment_date: '2026-09-20' },
          { 'X-Idempotency-Key': key() }
        )
      )
    );
    expect(res.status).toBe(201);
    const p = res.json.payment;
    expect(p).toMatchObject({ business_id: B, supplier_id: SUPP, customer_id: null, reference_id: null, created_by: A });
    const after = await snapshot();
    expect(after.payments).toBe(before.payments + 1);
    expect(after.vouchers).toBe(before.vouchers + 1);
    expect(after.lines).toBe(before.lines + 2);
    expect(after.supp).toBe(before.supp - 60);
    const t = await voucherTotals(p.id);
    expect(t.dr).toBe(t.cr);
    expect(await voucher(p.id)).toEqual([
      { code: '1101', dr: 0, cr: 60 },
      { code: '2101', dr: 60, cr: 0 },
    ]);
  });

  test('3 cross-business or unknown party is rejected with no side effects', async () => {
    const before = await snapshot();
    const k = key();
    const results = await Promise.all([
      call(postPayment(req(receipt({ customer_id: FOREIGN_CUST }), { 'X-Idempotency-Key': k }))),
      call(
        postPayment(
          req({ ...spoof, type: 'payable', supplier_id: FOREIGN_SUPP, amount: 10, payment_date: '2026-09-20' }, {
            'X-Idempotency-Key': key(),
          })
        )
      ),
      call(postPayment(req(receipt({ customer_id: randomUUID() }), { 'X-Idempotency-Key': key() }))),
      call(postPayment(req(receipt({ customer_id: undefined }), { 'X-Idempotency-Key': key() }))),
    ]);
    expect(results.map((r) => r.status)).toEqual([404, 404, 404, 400]);
    expect(results.map((r) => r.json.code)).toEqual([
      'PAYMENT_PARTY_NOT_FOUND',
      'PAYMENT_PARTY_NOT_FOUND',
      'PAYMENT_PARTY_NOT_FOUND',
      'PAYMENT_PARTY_INVALID',
    ]);
    expect(await snapshot()).toEqual(before);
    expect(await keyRow(k)).toBeUndefined();
  });

  test('4 invalid amount, date, mode, or key is rejected with no side effects', async () => {
    const before = await snapshot();
    const bodies: Array<[Record<string, unknown>, Record<string, string>, string]> = [
      [receipt({ amount: 0 }), {}, 'PAYMENT_AMOUNT_INVALID'],
      [receipt({ amount: -5 }), {}, 'PAYMENT_AMOUNT_INVALID'],
      [receipt({ amount: 'abc' }), {}, 'PAYMENT_AMOUNT_INVALID'],
      [receipt({ amount: '1e3' }), {}, 'PAYMENT_AMOUNT_INVALID'],
      [receipt({ amount: Number.POSITIVE_INFINITY }), {}, 'PAYMENT_AMOUNT_INVALID'],
      [receipt({ amount: true }), {}, 'PAYMENT_AMOUNT_INVALID'],
      [receipt({ amount: 1e12 }), {}, 'PAYMENT_AMOUNT_INVALID'],
      [receipt({ amount: 0, tds_amount: 10 }), {}, 'PAYMENT_AMOUNT_INVALID'],
      [receipt({ tds_amount: 'ten' }), {}, 'PAYMENT_AMOUNT_INVALID'],
      [receipt({ payment_date: '2026-02-30' }), {}, 'PAYMENT_DATE_INVALID'],
      [receipt({ payment_date: 20260920 }), {}, 'PAYMENT_DATE_INVALID'],
      [receipt({ payment_mode: '   ' }), {}, 'PAYMENT_MODE_INVALID'],
      [receipt({ payment_mode: 'x'.repeat(51) }), {}, 'PAYMENT_MODE_INVALID'],
      [receipt(), { 'X-Idempotency-Key': 'has space' }, 'IDEMPOTENCY_KEY_INVALID'],
      [receipt(), { 'X-Idempotency-Key': 'k'.repeat(201) }, 'IDEMPOTENCY_KEY_INVALID'],
      [receipt(), { 'X-Idempotency-Key': 'a', 'Idempotency-Key': 'b' }, 'IDEMPOTENCY_KEY_INVALID'],
    ];
    for (const [body, headers, code] of bodies) {
      const res = await call(postPayment(req(body, headers)));
      expect({ status: res.status, code: res.json.code }).toEqual({ status: 400, code });
    }
    expect(await snapshot()).toEqual(before);
  });

  test('5 same key and same request returns the original payment with no new writes', async () => {
    const k = key();
    const first = await call(postPayment(req(receipt({ amount: 50 }), { 'X-Idempotency-Key': k })));
    expect(first.status).toBe(201);
    const afterFirst = await snapshot();

    const retry = await call(postPayment(req(receipt({ amount: '50.00' }), { 'X-Idempotency-Key': k })));
    const aliasRetry = await call(postPayment(req(receipt({ amount: 50 }), { 'Idempotency-Key': k })));
    expect(retry.status).toBe(201);
    expect(retry.replayed).toBe('true');
    expect(retry.json.payment.id).toBe(first.json.payment.id);
    expect(retry.json.payment).toEqual(first.json.payment);
    expect(aliasRetry.status).toBe(201);
    expect(aliasRetry.json.payment.id).toBe(first.json.payment.id);
    expect(await snapshot()).toEqual(afterFirst);

    const row = await keyRow(k);
    expect(row).toMatchObject({ status: 'completed', action_type: 'payments.create', entity_id: first.json.payment.id });
    expect(row.request_payload).not.toHaveProperty('notes');

    // A retry still returns the original after the period is locked.
    await pool.query(
      `INSERT INTO period_locks (business_id, branch_id, financial_year, period_start, period_end, is_locked, locked_by)
       VALUES ($1, NULL, '2026-27', '2026-09-20', '2026-09-20', true, $2)`,
      [B, A]
    );
    const locked = await call(postPayment(req(receipt({ amount: 50 }), { 'X-Idempotency-Key': k })));
    expect(locked.status).toBe(201);
    expect(locked.json.payment.id).toBe(first.json.payment.id);
    expect(await snapshot()).toEqual(afterFirst);
  });

  test('6 same key with a different request returns 409 and changes nothing', async () => {
    const k = key();
    const first = await call(postPayment(req(receipt({ amount: 40 }), { 'X-Idempotency-Key': k })));
    expect(first.status).toBe(201);
    const before = await snapshot();
    const rowBefore = await keyRow(k);

    const variants = [
      receipt({ amount: 41 }),
      receipt({ amount: 40, payment_mode: 'upi' }),
      receipt({ amount: 40, payment_date: '2026-09-21' }),
      receipt({ amount: 40, notes: 'Different note' }),
      { ...spoof, type: 'payable', supplier_id: SUPP, amount: 40, payment_mode: 'cash', payment_date: '2026-09-20' },
    ];
    for (const body of variants) {
      const res = await call(postPayment(req(body, { 'X-Idempotency-Key': k })));
      expect({ status: res.status, code: res.json.code }).toEqual({ status: 409, code: 'IDEMPOTENCY_KEY_REUSED' });
    }
    expect(await snapshot()).toEqual(before);
    expect(await keyRow(k)).toEqual(rowBefore);
  });

  test('7 concurrent requests with one key create exactly one payment and one voucher', async () => {
    const k = key();
    const before = await snapshot();
    const results = await Promise.all(
      Array.from({ length: 4 }, () => call(postPayment(req(receipt({ amount: 33 }), { 'X-Idempotency-Key': k }))))
    );
    expect(results.map((r) => r.status)).toEqual([201, 201, 201, 201]);
    const ids = new Set(results.map((r) => r.json.payment.id));
    expect(ids.size).toBe(1);
    expect(results.filter((r) => r.replayed === 'true')).toHaveLength(3);
    const after = await snapshot();
    expect(after.payments).toBe(before.payments + 1);
    expect(after.vouchers).toBe(before.vouchers + 1);
    expect(after.lines).toBe(before.lines + 2);
    expect(after.keys).toBe(before.keys + 1);
    expect(after.cust).toBe(before.cust - 33);
    const t = await voucherTotals([...ids][0]);
    expect(t).toEqual({ dr: 33, cr: 33, n: 2 });
  });

  test('8 two keys for otherwise identical payments create two payments', async () => {
    const before = await snapshot();
    const a = await call(postPayment(req(receipt({ amount: 25 }), { 'X-Idempotency-Key': key() })));
    const b = await call(postPayment(req(receipt({ amount: 25 }), { 'X-Idempotency-Key': key() })));
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(a.json.payment.id).not.toBe(b.json.payment.id);
    const after = await snapshot();
    expect(after.payments).toBe(before.payments + 2);
    expect(after.vouchers).toBe(before.vouchers + 2);
    expect(after.lines).toBe(before.lines + 4);
    expect(after.keys).toBe(before.keys + 2);
    expect(after.cust).toBe(before.cust - 50);
    for (const id of [a.json.payment.id, b.json.payment.id]) {
      const t = await voucherTotals(id);
      expect(t.dr).toBe(t.cr);
    }
  });

  test('9 requests without a key keep the existing behavior and are not deduplicated', async () => {
    const before = await snapshot();
    const a = await call(postPayment(req(receipt({ amount: 15 }))));
    const b = await call(postPayment(req(receipt({ amount: 15 }))));
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(a.replayed).toBeNull();
    expect(b.replayed).toBeNull();
    expect(a.json.payment.id).not.toBe(b.json.payment.id);
    const after = await snapshot();
    expect(after.payments).toBe(before.payments + 2);
    expect(after.vouchers).toBe(before.vouchers + 2);
    expect(after.keys).toBe(before.keys);
    expect(after.cust).toBe(before.cust - 30);
  });

  test('10 a failed transaction leaves no idempotency record and the key can be retried', async () => {
    const k = key();
    const before = await snapshot();
    const spy = jest
      .spyOn(ledgerUtils, 'createPaymentLedgerEntries')
      .mockRejectedValueOnce(new Error('simulated ledger failure'));
    const failed = await call(postPayment(req(receipt({ amount: 20 }), { 'X-Idempotency-Key': k })));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(failed.status).toBe(500);
    expect(await snapshot()).toEqual(before);
    expect(await keyRow(k)).toBeUndefined();

    spy.mockRestore();
    const retry = await call(postPayment(req(receipt({ amount: 20 }), { 'X-Idempotency-Key': k })));
    expect(retry.status).toBe(201);
    expect(retry.replayed).toBeNull();
    const after = await snapshot();
    expect(after.payments).toBe(before.payments + 1);
    expect(after.vouchers).toBe(before.vouchers + 1);
    expect(after.keys).toBe(before.keys + 1);
    expect(after.cust).toBe(before.cust - 20);
    expect(await keyRow(k)).toMatchObject({ status: 'completed', entity_id: retry.json.payment.id });
  });

  test('a document payment with a key still returns the original after the invoice is settled', async () => {
    const inv = randomUUID();
    await pool.query(
      `INSERT INTO invoices (id, business_id, customer_id, invoice_number, invoice_date, status, document_type,
          place_of_supply_state_code, subtotal, tax_total, cgst_total, sgst_total, igst_total, grand_total,
          paid_amount, balance_amount, payment_status, branch_id)
       VALUES ($1, $2, $3, $4, '2026-09-20', 'final', 'tax_invoice', '27', 100, 0, 0, 0, 0, 100, 0, 100, 'unpaid', $5)`,
      [inv, B, CUST, `INV-${tag}-${inv.slice(0, 4)}`, BR]
    );
    const k = key();
    const body = { ...spoof, type: 'receivable', reference_type: 'invoice', reference_id: inv, amount: 100, payment_date: '2026-09-20' };
    const first = await call(postPayment(req(body, { 'X-Idempotency-Key': k })));
    expect(first.status).toBe(201);
    const afterFirst = await snapshot();
    const retry = await call(postPayment(req(body, { 'X-Idempotency-Key': k })));
    expect(retry.status).toBe(201);
    expect(retry.json.payment.id).toBe(first.json.payment.id);
    expect(await snapshot()).toEqual(afterFirst);
    const paid = (await pool.query(`SELECT paid_amount::float8 AS paid FROM invoices WHERE id = $1`, [inv])).rows[0].paid;
    expect(paid).toBe(100);
  });
});
