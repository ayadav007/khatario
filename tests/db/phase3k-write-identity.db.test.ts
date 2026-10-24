/**
 * Phase 3K audit of six write handlers. Does not stub authorize.
 * Connects only after current_database() is kh_phase2_test on localhost port 5433.
 */
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import type { Pool } from 'pg';
import { NextRequest } from 'next/server';

function readEnvFile(file: string): Record<string, string> {
  const text = fs.readFileSync(file, 'utf8');
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    let val = m[2].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    out[m[1]] = val;
  }
  return out;
}

function forceDisposableDatabase(): void {
  const env = readEnvFile(path.resolve(process.cwd(), '.env'));
  const host = env.DB_HOST || '';
  if (host !== 'localhost' && host !== '127.0.0.1' && host !== '::1') {
    throw new Error('Refusing Phase 3K tests: database host is not local');
  }
  if (!env.DB_USER || env.DB_PASSWORD == null) throw new Error('Refusing Phase 3K tests: local database credentials are missing');
  const port = env.DB_PORT || '5432';
  process.env.DATABASE_URL = `postgresql://${encodeURIComponent(env.DB_USER)}:${encodeURIComponent(env.DB_PASSWORD)}@${host}:${port}/kh_phase2_test`;
  process.env.DB_NAME = 'kh_phase2_test';
}

forceDisposableDatabase();

const headerBag: { current: Record<string, string> } = { current: {} };
(global as unknown as { __p3kHeaders: typeof headerBag }).__p3kHeaders = headerBag;

jest.mock('next/headers', () => ({
  headers: jest.fn(async () => ({
    get: (name: string) =>
      (global as unknown as { __p3kHeaders: { current: Record<string, string> } }).__p3kHeaders.current[name.toLowerCase()] ?? null,
  })),
  cookies: jest.fn(async () => ({ get: () => undefined })),
}));
jest.mock('@/lib/jwt', () => ({
  clearSessionCookie: jest.fn(),
  shouldRotateTokens: jest.fn(async () => ({ rotate: false, payload: null })),
}));
jest.mock('@/lib/platform-jwt', () => ({ getPlatformSessionFromRequest: jest.fn(async () => null) }));
jest.mock('@/lib/credit-alerts', () => ({ checkAndSendCreditAlerts: jest.fn(async () => undefined) }));

import { getPool, closePool } from '@/lib/db';
import { withLedgerDelete } from '@/lib/accounting/ledger-delete-guard';
import { middleware } from '../../middleware';
import { POST as postStockTransfer } from '@/app/api/stock-transfers/route';
import { POST as postPurchaseReturn } from '@/app/api/purchase-returns/route';
import { POST as postPurchase } from '@/app/api/purchases/route';
import { POST as postPayment } from '@/app/api/payments/route';
import { POST as postJournal } from '@/app/api/journal-entries/route';
import { POST as postRecurring } from '@/app/api/recurring-invoices/route';

type Handler = (request: NextRequest) => Promise<Response>;

describe('Phase 3K write identity', () => {
  jest.setTimeout(180000);
  let pool: Pool;
  const A = randomUUID();
  const B = randomUUID();
  const branchA = randomUUID();
  const branchB = randomUUID();
  const ownerA = randomUUID();
  const ownerB = randomUUID();
  const staffA = randomUUID();
  const customerA = randomUUID();
  const customerB = randomUUID();
  const supplierA = randomUUID();
  const supplierB = randomUUID();
  const itemA = randomUUID();
  const itemB = randomUUID();
  const whA1 = randomUUID();
  const whA2 = randomUUID();
  const whB1 = randomUUID();
  const whB2 = randomUUID();
  const purchaseB = randomUUID();
  const tag = A.slice(0, 8);
  const day = '2026-10-19';

  function session(userId: string, businessId: string, version = '1') {
    return {
      'x-authenticated-user-id': userId,
      'x-authenticated-business-id': businessId,
      'x-authenticated-session-version': version,
    };
  }

  async function send(handler: Handler, path: string, body: Record<string, unknown>, headers: Record<string, string>) {
    headerBag.current = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
    try {
      const res = await handler(
        new NextRequest(
          `http://localhost/api/${path}?business_id=${encodeURIComponent(String(body.business_id || ''))}&user_id=${encodeURIComponent(String(body.user_id || body.created_by || ''))}`,
          {
            method: 'POST',
            headers: { ...headers, 'content-type': 'application/json' },
            body: JSON.stringify(body),
          },
        ),
      );
      const text = await res.text();
      return { status: res.status, text: text.slice(0, 500) };
    } catch (error) {
      return { status: 0, text: error instanceof Error ? error.message : String(error) };
    }
  }

  async function counts(businessId: string) {
    const row = await pool.query(
      `SELECT
         (SELECT COUNT(*) FROM stock_transfers WHERE business_id = $1)::text AS transfers,
         (SELECT COUNT(*) FROM stock_transfer_items sti
            JOIN stock_transfers st ON st.id = sti.transfer_id
           WHERE st.business_id = $1)::text AS transfer_items,
         (SELECT COUNT(*) FROM purchase_returns WHERE business_id = $1)::text AS returns,
         (SELECT COUNT(*) FROM purchases WHERE business_id = $1)::text AS purchases,
         (SELECT COUNT(*) FROM payments WHERE business_id = $1)::text AS payments,
         (SELECT COUNT(*) FROM recurring_invoices WHERE business_id = $1)::text AS recurring,
         (SELECT COUNT(*) FROM journal_entries WHERE business_id = $1)::text AS journals,
         (SELECT COUNT(*) FROM ledger_entry_lines WHERE business_id = $1)::text AS ledger,
         (SELECT COUNT(*) FROM stock_movements WHERE business_id = $1)::text AS stock,
         (SELECT COALESCE(SUM(current_balance), 0)::text FROM suppliers WHERE business_id = $1) AS supplier_balance,
         (SELECT COALESCE(SUM(current_balance), 0)::text FROM customers WHERE business_id = $1) AS customer_balance`,
      [businessId],
    );
    return row.rows[0] as Record<string, string>;
  }

  function identity(businessId: string, userId: string) {
    return { business_id: businessId, user_id: userId, created_by: userId, created_by_user_id: userId };
  }

  function transferBody(businessId: string, userId: string, itemId: string, from: string, to: string) {
    return {
      ...identity(businessId, userId),
      transfer_number: `P3K-T-${randomUUID().slice(0, 8)}`,
      transfer_date: day,
      from_location_id: from,
      to_location_id: to,
      items: [{ item_id: itemId, qty: 1, unit: 'PCS' }],
    };
  }

  function returnBody(businessId: string, userId: string, supplierId: string, itemId: string) {
    return {
      ...identity(businessId, userId),
      supplier_id: supplierId,
      return_number: `P3K-R-${randomUUID().slice(0, 8)}`,
      return_date: day,
      items: [{ item_id: itemId, description: 'Widget', qty: 1, unit_price: 10, tax_rate: 0, unit: 'PCS' }],
    };
  }

  function purchaseBody(businessId: string, userId: string, supplierId: string, itemId: string) {
    return {
      ...identity(businessId, userId),
      branch_id: businessId === A ? branchA : branchB,
      supplier_id: supplierId,
      bill_number: `P3K-P-${randomUUID().slice(0, 8)}`,
      bill_date: day,
      status: 'draft',
      paid_amount: 0,
      supplier_state_code: '27',
      place_of_supply_state_code: '27',
      rcm_review: 'not_reverse_charge',
      items: [{ item_id: itemId, item_name: 'Widget', hsn_sac: '847130', unit: 'PCS', quantity: 1, unit_price: 10, tax_rate: 0 }],
    };
  }

  function paymentBody(businessId: string, userId: string, party: { customer_id?: string; supplier_id?: string }) {
    return {
      ...identity(businessId, userId),
      type: party.customer_id ? 'receivable' : 'payable',
      amount: 10,
      payment_mode: 'cash',
      payment_date: day,
      ...party,
    };
  }

  function journalBody(businessId: string, userId: string, debitId: string, creditId: string, debit = 10, credit = 10) {
    return {
      ...identity(businessId, userId),
      entry_date: day,
      narration: 'P3K',
      lines: [
        { account_id: debitId, debit, credit: 0 },
        { account_id: creditId, debit: 0, credit },
      ],
    };
  }

  function recurringBody(businessId: string, userId: string, customerId: string, itemId: string) {
    return {
      ...identity(businessId, userId),
      customer_id: customerId,
      frequency: 'monthly',
      start_date: day,
      items: [{ item_id: itemId, name: 'Widget', quantity: 1, unit_price: 10 }],
    };
  }

  async function accountPair(businessId: string) {
    const row = await pool.query<{ debit_id: string; credit_id: string }>(
      `SELECT
         (SELECT id FROM accounts WHERE business_id = $1 AND nature = 'debit' ORDER BY account_code LIMIT 1) AS debit_id,
         (SELECT id FROM accounts WHERE business_id = $1 AND nature = 'credit' ORDER BY account_code LIMIT 1) AS credit_id`,
      [businessId],
    );
    const pair = row.rows[0];
    if (!pair?.debit_id || !pair.credit_id) throw new Error(`No accounts for ${businessId}`);
    return pair;
  }

  function assertDenied(label: string, res: { status: number; text: string }, before: unknown, after: unknown) {
    const denied = res.status === 401 || res.status === 403;
    const same = JSON.stringify(before) === JSON.stringify(after);
    if (!denied || !same) {
      throw new Error(`${label} HTTP ${res.status} ${res.text}\nbefore ${JSON.stringify(before)}\nafter ${JSON.stringify(after)}`);
    }
  }

  async function purge(ids: string[]) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await withLedgerDelete(client, 'admin:seed_demo', null, async () => {
        await client.query(`DELETE FROM ledger_entry_lines WHERE business_id = ANY($1::uuid[])`, [ids]);
        await client.query(`DELETE FROM ledger_entries WHERE business_id = ANY($1::uuid[])`, [ids]);
      });
      await client.query(`DELETE FROM offline_replay_log WHERE business_id = ANY($1::uuid[])`, [ids]);
      await client.query(`DELETE FROM stock_movements WHERE business_id = ANY($1::uuid[])`, [ids]);
      await client.query(
        `DELETE FROM stock_transfer_items WHERE transfer_id IN (SELECT id FROM stock_transfers WHERE business_id = ANY($1::uuid[]) OR created_by IN (SELECT id FROM users WHERE business_id = ANY($1::uuid[])))`,
        [ids],
      );
      await client.query(
        `DELETE FROM stock_transfers WHERE business_id = ANY($1::uuid[]) OR created_by IN (SELECT id FROM users WHERE business_id = ANY($1::uuid[]))`,
        [ids],
      );
      await client.query(
        `DELETE FROM purchase_return_items WHERE return_id IN (SELECT id FROM purchase_returns WHERE business_id = ANY($1::uuid[]))`,
        [ids],
      );
      await client.query(`DELETE FROM purchase_returns WHERE business_id = ANY($1::uuid[])`, [ids]);
      await client.query(`DELETE FROM payments WHERE business_id = ANY($1::uuid[])`, [ids]);
      await client.query(`DELETE FROM recurring_invoices WHERE business_id = ANY($1::uuid[])`, [ids]);
      await client.query(`DELETE FROM journal_entries WHERE business_id = ANY($1::uuid[])`, [ids]);
      await client.query(
        `DELETE FROM purchase_items WHERE purchase_id IN (SELECT id FROM purchases WHERE business_id = ANY($1::uuid[]))`,
        [ids],
      );
      await client.query(`DELETE FROM purchases WHERE business_id = ANY($1::uuid[])`, [ids]);
      await client.query(`DELETE FROM location_stock WHERE item_id IN (SELECT id FROM items WHERE business_id = ANY($1::uuid[]))`, [ids]);
      await client.query(`DELETE FROM branch_item_stock WHERE business_id = ANY($1::uuid[])`, [ids]);
      await client.query(`DELETE FROM branch_warehouses WHERE warehouse_id IN (SELECT id FROM warehouses WHERE business_id = ANY($1::uuid[]))`, [ids]);
      await client.query(`DELETE FROM warehouses WHERE business_id = ANY($1::uuid[])`, [ids]);
      for (const id of ids) {
        await client.query(`DELETE FROM user_branches WHERE user_id IN (SELECT id FROM users WHERE business_id = $1)`, [id]);
        await client.query(`DELETE FROM items WHERE business_id = $1`, [id]);
        await client.query(`DELETE FROM suppliers WHERE business_id = $1`, [id]);
        await client.query(`DELETE FROM customers WHERE business_id = $1`, [id]);
        await client.query(`DELETE FROM accounts WHERE business_id = $1`, [id]);
        await client.query(`DELETE FROM users WHERE business_id = $1`, [id]);
        await client.query(`DELETE FROM business_module_subscriptions WHERE business_id = $1`, [id]);
        await client.query(`DELETE FROM business_modules WHERE business_id = $1`, [id]);
        await client.query(`DELETE FROM branches WHERE business_id = $1`, [id]);
        await client.query(`DELETE FROM businesses WHERE id = $1`, [id]);
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  beforeAll(async () => {
    pool = getPool();
    const db = await pool.query<{ db: string; addr: string; port: number }>(
      `SELECT current_database() AS db, inet_server_addr()::text AS addr, inet_server_port() AS port`,
    );
    const info = db.rows[0];
    if (info.db !== 'kh_phase2_test' || info.port !== 5433 || (!info.addr.includes('127.0.0.1') && !info.addr.includes('::1'))) {
      throw new Error(`Refusing Phase 3K tests against ${info.db} at ${info.addr}:${info.port}`);
    }
    const plan = await pool.query<{ plan_id: string }>(
      `SELECT plan_id FROM subscription_plan_features
        WHERE enabled = true AND feature_id IN (
          'settings_multi_warehouse','purchase_management','sales_credit_notes','sales_recurring_invoices','advanced_ledger'
        )
        GROUP BY plan_id
        ORDER BY COUNT(DISTINCT feature_id) DESC
        LIMIT 1`,
    );
    if (!plan.rows[0]) throw new Error('No subscription plan');
    const orphans = await pool.query<{ id: string }>(`SELECT id FROM businesses WHERE name LIKE 'P3K %'`);
    if (orphans.rows.length) await purge(orphans.rows.map((row) => row.id));
    const planId = plan.rows[0].plan_id;
    for (const [id, name, gst] of [
      [A, `P3K A ${tag}`, '27AAAPA1234A1Z5'],
      [B, `P3K B ${tag}`, '29AAAPA1234A1Z5'],
    ] as const) {
      await pool.query(
        `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type, primary_module)
         VALUES ($1, $2, $3, $4, 'regular', 'billing')`,
        [id, name, gst, gst.slice(0, 2)],
      );
      await pool.query(
        `INSERT INTO business_modules (business_id, module_key, enabled, source) VALUES ($1, 'billing', true, 'test')`,
        [id],
      );
      await pool.query(
        `INSERT INTO business_module_subscriptions (business_id, module_key, plan_id, status, start_date, end_date)
         VALUES ($1, 'billing', $2, 'active', CURRENT_DATE, CURRENT_DATE + 30)`,
        [id, planId],
      );
      await pool.query(`SELECT create_default_chart_of_accounts($1)`, [id]);
      await pool.query(`SELECT ensure_standard_account_heads($1)`, [id]);
    }
    await pool.query(
      `INSERT INTO branches (id, business_id, name, state_code, is_default, is_active) VALUES
         ($1, $3, 'Main', '27', true, true), ($2, $4, 'Main', '29', true, true)`,
      [branchA, branchB, A, B],
    );
    const phone = Date.now().toString().slice(-7);
    await pool.query(
      `INSERT INTO users (id, business_id, name, phone, is_primary_admin, auth_session_version, is_active)
       VALUES ($1, $3, 'Owner A', $4, true, 1, true), ($2, $5, 'Owner B', $6, true, 1, true),
              ($7, $3, 'Staff A', $8, false, 1, true)`,
      [ownerA, ownerB, A, `75${phone}1`, B, `75${phone}2`, staffA, `75${phone}3`],
    );
    await pool.query(
      `INSERT INTO user_branches (user_id, branch_id, can_view, can_edit, can_delete, can_create_transactions)
       VALUES ($1, $2, true, true, true, true), ($3, $4, true, true, true, true)`,
      [ownerA, branchA, ownerB, branchB],
    );
    await pool.query(
      `INSERT INTO customers (id, business_id, name, is_active, current_balance) VALUES
         ($1, $2, 'P3K A', true, 100), ($3, $4, 'P3K B', true, 100)`,
      [customerA, A, customerB, B],
    );
    await pool.query(
      `INSERT INTO suppliers (id, business_id, name, is_active, state_code, current_balance) VALUES
         ($1, $2, 'P3K A', true, '27', 100), ($3, $4, 'P3K B', true, '29', 100)`,
      [supplierA, A, supplierB, B],
    );
    await pool.query(
      `INSERT INTO items (id, business_id, name, item_type, unit, selling_price, purchase_price, tax_rate, hsn_sac)
       VALUES ($1, $2, 'Widget A', 'goods', 'PCS', 10, 8, 0, '847130'),
              ($3, $4, 'Widget B', 'goods', 'PCS', 10, 8, 0, '847130')`,
      [itemA, A, itemB, B],
    );
    await pool.query(
      `INSERT INTO purchases (id, business_id, supplier_id, bill_number, bill_date, status, place_of_supply_state_code,
          is_reverse_charge, itc_eligible, subtotal, tax_total, cgst_total, sgst_total, igst_total, grand_total,
          paid_amount, balance_amount, payment_status, branch_id)
       VALUES ($1, $2, $3, $4, '2026-10-19', 'final', '29', false, true, 10, 0, 0, 0, 0, 10, 0, 10, 'unpaid', $5)`,
      [purchaseB, B, supplierB, `P3K-BILL-${tag}`, branchB],
    );
    await pool.query(
      `INSERT INTO branch_item_stock (business_id, branch_id, item_id, quantity) VALUES ($1, $2, $3, 10), ($4, $5, $6, 10)`,
      [A, branchA, itemA, B, branchB, itemB],
    );
    await pool.query(
      `INSERT INTO warehouses (id, business_id, branch_id, name, is_active) VALUES
         ($1, $5, $6, 'A1', true), ($2, $5, $6, 'A2', true), ($3, $7, $8, 'B1', true), ($4, $7, $8, 'B2', true)`,
      [whA1, whA2, whB1, whB2, A, branchA, B, branchB],
    );
  });

  afterAll(async () => {
    try {
      await purge([A, B]);
    } finally {
      await closePool();
    }
  });

  const routes: Array<[string, Handler]> = [
    ['stock-transfers', postStockTransfer],
    ['purchase-returns', postPurchaseReturn],
    ['purchases', postPurchase],
    ['payments', postPayment],
    ['journal-entries', postJournal],
    ['recurring-invoices', postRecurring],
  ];

  function bodyFor(path: string, businessId: string, userId: string, foreign = false) {
    const item = foreign ? (businessId === A ? itemB : itemA) : businessId === A ? itemA : itemB;
    const supplier = foreign ? (businessId === A ? supplierB : supplierA) : businessId === A ? supplierA : supplierB;
    const customer = foreign ? (businessId === A ? customerB : customerA) : businessId === A ? customerA : customerB;
    const from = businessId === A ? whA1 : whB1;
    const to = businessId === A ? whA2 : whB2;
    if (path === 'stock-transfers') return transferBody(businessId, userId, item, from, to);
    if (path === 'purchase-returns') return returnBody(businessId, userId, supplier, item);
    if (path === 'purchases') return purchaseBody(businessId, userId, supplier, item);
    if (path === 'payments') return paymentBody(businessId, userId, { customer_id: customer });
    if (path === 'recurring-invoices') return recurringBody(businessId, userId, customer, item);
    return null;
  }

  test('middleware rejects these writes without a cookie', async () => {
    headerBag.current = {};
    for (const [name] of routes) {
      const res = await middleware(
        new NextRequest(`https://app.khatario.test/api/${name}`, {
          method: 'POST',
          headers: {
            host: 'app.khatario.test',
            'content-type': 'application/json',
            'x-authenticated-user-id': ownerB,
            'x-authenticated-business-id': B,
          },
          body: JSON.stringify({ business_id: B }),
        }),
      );
      expect(res.status).toBe(401);
    }
  });

  test('forged identity does not write business B', async () => {
    const accountsB = await accountPair(B);
    const attacks: Array<[string, Record<string, string>, string]> = [
      ['no session', {}, ownerB],
      ['user A with business B', session(ownerA, B), ownerA],
      ['user A header only', { 'x-authenticated-user-id': ownerA, 'x-authenticated-session-version': '1' }, ownerA],
      ['user B header only', { 'x-authenticated-user-id': ownerB, 'x-authenticated-session-version': '1' }, ownerB],
    ];
    const failures: string[] = [];
    for (const [label, headers, userId] of attacks) {
      for (const [name, handler] of routes) {
        const before = await counts(B);
        const body =
          name === 'journal-entries'
            ? journalBody(B, userId, accountsB.debit_id, accountsB.credit_id)
            : bodyFor(name, B, userId)!;
        const res = await send(handler, name, body, headers);
        const after = await counts(B);
        const wrote = res.status === 201 || res.status === 200 || JSON.stringify(before) !== JSON.stringify(after);
        const explicit =
          res.status === 401 ||
          res.status === 403 ||
          (res.status === 400 && res.text.includes('INVALID_CREATED_BY'));
        if (wrote || !explicit) failures.push(`${label} ${name} HTTP ${res.status} ${res.text.slice(0, 160)}`);
      }
    }
    if (failures.length) throw new Error(failures.join('\n'));
  });

  test('a stale session does not write', async () => {
    const accountsA = await accountPair(A);
    const headers = session(ownerA, A, '999');
    for (const [name, handler] of routes) {
      const beforeA = await counts(A);
      const beforeB = await counts(B);
      const body =
        name === 'journal-entries'
          ? journalBody(A, ownerA, accountsA.debit_id, accountsA.credit_id)
          : bodyFor(name, A, ownerA)!;
      const res = await send(handler, name, body, headers);
      if (res.status !== 401 || JSON.stringify(beforeA) !== JSON.stringify(await counts(A)) || JSON.stringify(beforeB) !== JSON.stringify(await counts(B))) {
        throw new Error(`stale ${name} HTTP ${res.status} ${res.text}`);
      }
    }
  });

  test('a valid session for A with a body naming B does not write B', async () => {
    const accountsA = await accountPair(A);
    const headers = session(ownerA, A);
    for (const [name, handler] of routes) {
      const beforeB = await counts(B);
      const body =
        name === 'journal-entries'
          ? { ...journalBody(B, ownerB, accountsA.debit_id, accountsA.credit_id), business_id: B, created_by: ownerB }
          : { ...bodyFor(name, A, ownerA)!, business_id: B, user_id: ownerB, created_by: ownerB };
      const res = await send(handler, name, body, headers);
      const afterB = await counts(B);
      if (JSON.stringify(beforeB) !== JSON.stringify(afterB)) {
        throw new Error(`body B ${name} HTTP ${res.status} ${res.text}`);
      }
    }
  });

  test('a valid session for A cannot use business B records', async () => {
    const accountsB = await accountPair(B);
    const headers = session(ownerA, A);
    const cases: Array<[string, Handler, Record<string, unknown>]> = [
      ['stock-transfers source', postStockTransfer, transferBody(A, ownerA, itemA, whB1, whA2)],
      ['stock-transfers destination', postStockTransfer, transferBody(A, ownerA, itemA, whA1, whB2)],
      ['stock-transfers item', postStockTransfer, transferBody(A, ownerA, itemB, whA1, whA2)],
      ['purchase-returns item', postPurchaseReturn, returnBody(A, ownerA, supplierA, itemB)],
      ['purchase-returns supplier', postPurchaseReturn, returnBody(A, ownerA, supplierB, itemA)],
      ['purchase-returns bill', postPurchaseReturn, { ...returnBody(A, ownerA, supplierA, itemA), purchase_id: purchaseB }],
      ['recurring item', postRecurring, recurringBody(A, ownerA, customerA, itemB)],
      ['purchases', postPurchase, purchaseBody(A, ownerA, supplierB, itemB)],
      ['payments customer', postPayment, paymentBody(A, ownerA, { customer_id: customerB })],
      ['payments supplier', postPayment, paymentBody(A, ownerA, { supplier_id: supplierB })],
      ['journal-entries', postJournal, journalBody(A, ownerA, accountsB.debit_id, accountsB.credit_id)],
      ['recurring-invoices', postRecurring, recurringBody(A, ownerA, customerB, itemB)],
    ];
    const failures: string[] = [];
    for (const [label, handler, body] of cases) {
      const beforeB = await counts(B);
      const beforeA = await counts(A);
      const res = await send(handler, label, { ...body, business_id: A }, headers);
      const afterB = await counts(B);
      const afterA = await counts(A);
      if (res.status === 201 || res.status === 200 || JSON.stringify(beforeB) !== JSON.stringify(afterB) || JSON.stringify(beforeA) !== JSON.stringify(afterA)) {
        failures.push(`foreign ${label} HTTP ${res.status} ${res.text.slice(0, 180)}`);
      } else if (![400, 403, 404].includes(res.status)) {
        failures.push(`foreign ${label} was not an ownership rejection HTTP ${res.status} ${res.text.slice(0, 180)}`);
      }
    }
    if (failures.length) throw new Error(failures.join('\n'));
  });

  test('a valid session for A can create its own records', async () => {
    const accountsA = await accountPair(A);
    const headers = session(ownerA, A);
    const beforeB = await counts(B);
    const own: Array<[string, Handler, Record<string, unknown>]> = [
      ['stock-transfers', postStockTransfer, transferBody(A, ownerA, itemA, whA1, whA2)],
      ['purchase-returns', postPurchaseReturn, returnBody(A, ownerA, supplierA, itemA)],
      ['purchases', postPurchase, purchaseBody(A, ownerA, supplierA, itemA)],
      ['payments', postPayment, paymentBody(A, ownerA, { customer_id: customerA })],
      ['journal-entries', postJournal, journalBody(A, ownerA, accountsA.debit_id, accountsA.credit_id)],
      ['recurring-invoices', postRecurring, recurringBody(A, ownerA, customerA, itemA)],
    ];
    for (const [label, handler, body] of own) {
      const res = await send(handler, label, body, headers);
      if (res.status !== 201) throw new Error(`own ${label} HTTP ${res.status} ${res.text}`);
    }
    const afterA = await counts(A);
    expect(Number(afterA.transfers)).toBeGreaterThan(0);
    expect(Number(afterA.returns)).toBeGreaterThan(0);
    expect(Number(afterA.purchases)).toBeGreaterThan(0);
    expect(Number(afterA.payments)).toBeGreaterThan(0);
    expect(Number(afterA.journals)).toBeGreaterThan(0);
    expect(Number(afterA.recurring)).toBeGreaterThan(0);
    expect(await counts(B)).toEqual(beforeB);
    const journal = await pool.query<{ debit: string; credit: string }>(
      `SELECT COALESCE(SUM(debit),0)::text AS debit, COALESCE(SUM(credit),0)::text AS credit
         FROM ledger_entry_lines WHERE business_id = $1 AND voucher_type = 'journal'`,
      [A],
    );
    expect(journal.rows[0].debit).toBe(journal.rows[0].credit);
  });

  test('an unbalanced journal does not post', async () => {
    const accountsA = await accountPair(A);
    const before = await counts(A);
    const res = await send(
      postJournal,
      'journal-entries',
      journalBody(A, ownerA, accountsA.debit_id, accountsA.credit_id, 10, 4),
      session(ownerA, A),
    );
    expect(res.status).toBe(400);
    expect(await counts(A)).toEqual(before);
  });

  test('a user without create permission cannot write', async () => {
    const accountsA = await accountPair(A);
    const headers = session(staffA, A);
    for (const [name, handler] of routes) {
      const before = await counts(A);
      const body =
        name === 'journal-entries'
          ? journalBody(A, staffA, accountsA.debit_id, accountsA.credit_id)
          : bodyFor(name, A, staffA)!;
      const res = await send(handler, name, body, headers);
      assertDenied(`staff ${name}`, res, before, await counts(A));
    }
  });

  test('a cancelled billing subscription cannot create a recurring invoice', async () => {
    await pool.query(`UPDATE business_module_subscriptions SET status = 'cancelled' WHERE business_id = $1`, [A]);
    try {
      const before = await counts(A);
      const res = await send(postRecurring, 'recurring-invoices', recurringBody(A, ownerA, customerA, itemA), session(ownerA, A));
      assertDenied('cancelled recurring', res, before, await counts(A));
    } finally {
      await pool.query(`UPDATE business_module_subscriptions SET status = 'active' WHERE business_id = $1`, [A]);
    }
  });
});
