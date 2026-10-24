/**
 * Phase 4.3 follow-up: a stored payment idempotency record is replayed only when it belongs to the
 * session business, has the payments.create scope, matches the request, and points at a payment in
 * that same business that still matches the stored request. Every rejection must leave payments,
 * ledger lines, party balances, and the stored record untouched.
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

d('Phase 4.3 payment replay ownership (real DB)', () => {
  jest.setTimeout(120000);

  let pool: Pool;
  const B = randomUUID();
  const B2 = randomUUID();
  const BR = randomUUID();
  const BR2 = randomUUID();
  const A = randomUUID();
  const A2 = randomUUID();
  const CUST = randomUUID();
  const FOREIGN_CUST = randomUUID();
  const FOREIGN_PAYMENT = randomUUID();
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

  const req = (body: unknown, k: string) =>
    new NextRequest(`http://localhost/api/payments?business_id=${B2}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-authenticated-user-id': A,
        'x-authenticated-business-id': B,
        'X-Idempotency-Key': k,
      },
      body: JSON.stringify(body),
    });

  const call = async (res: Response | Promise<Response>) => {
    const r = await res;
    const text = await r.text();
    return { status: r.status, text, json: JSON.parse(text || '{}'), replayed: r.headers.get('Idempotent-Replayed') };
  };

  const key = () => `pay-${randomUUID()}`;
  const receipt = (amount = 70) => ({
    business_id: B2,
    type: 'receivable',
    customer_id: CUST,
    amount,
    payment_mode: 'cash',
    payment_date: '2026-09-20',
    notes: 'Counter receipt',
  });

  async function snapshot() {
    return (
      await pool.query(
        `SELECT
           (SELECT COUNT(*)::int FROM payments WHERE business_id = ANY($1::uuid[])) AS payments,
           (SELECT COALESCE(SUM(amount), 0)::float8 FROM payments WHERE business_id = ANY($1::uuid[])) AS payment_total,
           (SELECT COUNT(*)::int FROM ledger_entry_lines WHERE business_id = ANY($1::uuid[])) AS lines,
           (SELECT COUNT(*)::int FROM offline_replay_log WHERE business_id = ANY($1::uuid[])) AS keys,
           (SELECT current_balance::float8 FROM customers WHERE id = $2) AS cust,
           (SELECT current_balance::float8 FROM customers WHERE id = $3) AS foreign_cust,
           (SELECT row_to_json(p)::text FROM payments p WHERE id = $4) AS foreign_payment`,
        [[B, B2], CUST, FOREIGN_CUST, FOREIGN_PAYMENT]
      )
    ).rows[0] as Record<string, unknown>;
  }

  async function replayRow(businessId: string, k: string) {
    return (
      await pool.query(`SELECT row_to_json(r)::jsonb AS row FROM offline_replay_log r WHERE business_id = $1 AND idempotency_key = $2`, [
        businessId,
        `payments.create:${k}`,
      ])
    ).rows[0]?.row as Record<string, unknown> | undefined;
  }

  async function recorded(amount = 70) {
    const k = key();
    const first = await call(postPayment(req(receipt(amount), k)));
    expect(first.status).toBe(201);
    return { k, payment: first.json.payment };
  }

  async function tamper(k: string, setSql: string, params: unknown[] = []) {
    await pool.query(
      `UPDATE offline_replay_log SET ${setSql} WHERE business_id = $1 AND idempotency_key = $2`,
      [B, `payments.create:${k}`, ...params]
    );
  }

  async function expectRejectedWithoutChanges(k: string, body: unknown, code: string) {
    const before = await snapshot();
    const rowBefore = await replayRow(B, k);
    const res = await call(postPayment(req(body, k)));
    expect({ status: res.status, code: res.json.code }).toEqual({ status: 409, code });
    expect(res.json).not.toHaveProperty('payment');
    expect(res.replayed).toBeNull();
    expect(res.text).not.toContain(FOREIGN_PAYMENT);
    expect(await snapshot()).toEqual(before);
    expect(await replayRow(B, k)).toEqual(rowBefore);
    return res;
  }

  beforeAll(async () => {
    pool = getPool();
    const gstA = `27AABCR${tag.slice(0, 4).toUpperCase()}C1Z5`;
    const gstB = `29AABCR${tag.slice(0, 4).toUpperCase()}D1Z5`;
    await pool.query(
      `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type)
       VALUES ($1, $2, $3, '27', 'regular'), ($4, $5, $6, '29', 'regular')`,
      [B, `Phase43r ${tag}`, gstA, B2, `Phase43r-b ${tag}`, gstB]
    );
    await pool.query(
      `INSERT INTO branches (id, business_id, name, state_code, is_primary, is_default, is_active)
       VALUES ($1, $2, 'Main', '27', true, true, true), ($3, $4, 'Main', '29', true, true, true)`,
      [BR, B, BR2, B2]
    );
    const phone = Date.now().toString().slice(-8);
    await pool.query(
      `INSERT INTO users (id, business_id, name, phone, is_primary_admin)
       VALUES ($1, $2, 'Clerk', $3, true), ($4, $5, 'Foreign Clerk', $6, true)`,
      [A, B, `95${phone}`, A2, B2, `96${phone}`]
    );
    for (const biz of [B, B2]) {
      await pool.query(`SELECT create_default_chart_of_accounts($1)`, [biz]);
      await pool.query(`SELECT ensure_standard_account_heads($1)`, [biz]);
    }
    await pool.query(
      `INSERT INTO customers (id, business_id, name, state_code, current_balance)
       VALUES ($1, $2, 'Asha', '27', 1000), ($3, $4, 'Foreign', '29', 500)`,
      [CUST, B, FOREIGN_CUST, B2]
    );
    // Same shape as a B receipt so only ownership distinguishes it.
    await pool.query(
      `INSERT INTO payments (id, business_id, branch_id, type, customer_id, amount, payment_mode, payment_date, notes, tds_amount, created_by)
       VALUES ($1, $2, $5, 'receivable', $3, 70, 'cash', '2026-09-20', 'Counter receipt', 0, $4)`,
      [FOREIGN_PAYMENT, B2, FOREIGN_CUST, A2, BR2]
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

  test('1 valid same-business replay returns the original payment and writes nothing', async () => {
    const { k, payment } = await recorded(70);
    const before = await snapshot();
    const rowBefore = await replayRow(B, k);

    const res = await call(postPayment(req(receipt(70), k)));
    expect(res.status).toBe(201);
    expect(res.replayed).toBe('true');
    expect(res.json.payment).toEqual(payment);
    expect(res.json.payment.business_id).toBe(B);
    expect(res.json.payment).not.toHaveProperty('__payment_day');
    expect(await snapshot()).toEqual(before);
    expect(await replayRow(B, k)).toEqual(rowBefore);
  });

  test("2 another business's record for the same key never returns that business's payment", async () => {
    // Plant a B2 record that mirrors a genuine B record (same key, same hash) but points at B2's payment.
    const { k: template } = await recorded(70);
    const source = (await replayRow(B, template))!;
    const k = key();
    await pool.query(
      `INSERT INTO offline_replay_log (business_id, idempotency_key, action_type, request_hash, request_payload,
          response_payload, status, entity_type, entity_id, completed_at)
       VALUES ($1, $2, 'payments.create', $3, $4, $5, 'completed', 'payment', $6, NOW())`,
      [B2, `payments.create:${k}`, source.request_hash, source.request_payload, { payment_id: FOREIGN_PAYMENT }, FOREIGN_PAYMENT]
    );
    const foreignRowBefore = await replayRow(B2, k);
    const before = await snapshot();

    const res = await call(postPayment(req(receipt(70), k)));
    expect(res.status).toBe(201);
    expect(res.replayed).toBeNull();
    expect(res.json.payment.business_id).toBe(B);
    expect(res.json.payment.id).not.toBe(FOREIGN_PAYMENT);
    expect(res.text).not.toContain(FOREIGN_PAYMENT);

    const after = await snapshot();
    expect(after.payments).toBe((before.payments as number) + 1);
    expect(after.foreign_payment).toBe(before.foreign_payment);
    expect(after.foreign_cust).toBe(before.foreign_cust);
    expect(await replayRow(B2, k)).toEqual(foreignRowBefore);
    expect(await replayRow(B, k)).toMatchObject({ status: 'completed', entity_id: res.json.payment.id });
  });

  test.each<[string, string, unknown[]]>([
    ['a different action type', `action_type = 'invoices.create'`, []],
    ['the offline payment action type', `action_type = 'payment.record'`, []],
    ['a non-payment entity type', `entity_type = 'invoice'`, []],
    ['a record left in manual review', `status = 'manual_review'`, []],
    ['a record still pending', `status = 'pending', completed_at = NULL`, []],
  ])('3 a record with %s cannot return a payment', async (_label, setSql, params) => {
    const { k } = await recorded(70);
    await tamper(k, setSql, params);
    await expectRejectedWithoutChanges(k, receipt(70), 'IDEMPOTENCY_REPLAY_UNAVAILABLE');
  });

  test.each<[string, string, () => unknown[]]>([
    ['another business', `entity_id = $3::uuid, response_payload = jsonb_build_object('payment_id', $3::text)`, () => [FOREIGN_PAYMENT]],
    ['a payment that does not exist', `entity_id = $3::uuid, response_payload = jsonb_build_object('payment_id', $3::text)`, () => [randomUUID()]],
    ['no payment at all', `entity_id = NULL`, () => []],
    ['a response payload that disagrees with the entity', `response_payload = jsonb_build_object('payment_id', $3::text)`, () => [FOREIGN_PAYMENT]],
  ])('4 a record pointing at %s fails safely', async (_label, setSql, params) => {
    const { k } = await recorded(70);
    await tamper(k, setSql, params());
    await expectRejectedWithoutChanges(k, receipt(70), 'IDEMPOTENCY_REPLAY_UNAVAILABLE');
  });

  test('4b a payment that no longer matches the stored request is not replayed', async () => {
    const { k } = await recorded(70);
    await tamper(k, `request_payload = jsonb_set(request_payload, '{amount}', to_jsonb(9900))`);
    await expectRejectedWithoutChanges(k, receipt(70), 'IDEMPOTENCY_REPLAY_UNAVAILABLE');
  });

  test('5 a different request with the same key returns 409 and changes nothing', async () => {
    const { k } = await recorded(70);
    const res = await expectRejectedWithoutChanges(k, receipt(71), 'IDEMPOTENCY_KEY_REUSED');
    expect(res.text).not.toContain('"amount"');
  });

  test('6 concurrent same-key requests still create exactly one payment', async () => {
    const k = key();
    const before = await snapshot();
    const results = await Promise.all(Array.from({ length: 4 }, () => call(postPayment(req(receipt(44), k)))));
    expect(results.map((r) => r.status)).toEqual([201, 201, 201, 201]);
    expect(new Set(results.map((r) => r.json.payment.id)).size).toBe(1);
    expect(results.filter((r) => r.replayed === 'true')).toHaveLength(3);
    const after = await snapshot();
    expect(after.payments).toBe((before.payments as number) + 1);
    expect(after.lines).toBe((before.lines as number) + 2);
    expect(after.keys).toBe((before.keys as number) + 1);
    expect(after.cust).toBe((before.cust as number) - 44);
  });

  test('6b concurrent retries against an unreplayable record all fail without writes', async () => {
    const { k } = await recorded(70);
    await tamper(k, `entity_id = $3`, [FOREIGN_PAYMENT]);
    const before = await snapshot();
    const rowBefore = await replayRow(B, k);
    const results = await Promise.all(Array.from({ length: 4 }, () => call(postPayment(req(receipt(70), k)))));
    expect(results.map((r) => [r.status, r.json.code])).toEqual(
      Array.from({ length: 4 }, () => [409, 'IDEMPOTENCY_REPLAY_UNAVAILABLE'])
    );
    expect(await snapshot()).toEqual(before);
    expect(await replayRow(B, k)).toEqual(rowBefore);
  });
});
