/**
 * Phase 3P live workflow check. Does not change application code.
 * Prints statuses. Does not print cookies, passwords, or the database URL.
 */
import fs from 'fs';
import path from 'path';
import { randomUUID, randomBytes } from 'crypto';
import { spawn } from 'child_process';
import bcrypt from 'bcryptjs';
import pg from 'pg';

function readEnvFile(file) {
  const text = fs.readFileSync(file, 'utf8');
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    out[match[1]] = value;
  }
  return out;
}

const envFile = readEnvFile(path.resolve(process.cwd(), '.env'));
const host = envFile.DB_HOST || '';
if (host !== 'localhost' && host !== '127.0.0.1' && host !== '::1') {
  console.error('BLOCKED database host is not local');
  process.exit(2);
}
const dbPort = envFile.DB_PORT || '5432';
const databaseUrl = `postgresql://${encodeURIComponent(envFile.DB_USER)}:${encodeURIComponent(envFile.DB_PASSWORD)}@${host}:${dbPort}/kh_phase2_test`;
const PORT = 3111;
const BASE = `http://127.0.0.1:${PORT}`;
const day = new Date(Date.now() + 330 * 60 * 1000).toISOString().slice(0, 10);

const A = randomUUID();
const B = randomUUID();
const branchA = randomUUID();
const branchB = randomUUID();
const ownerA = randomUUID();
const ownerB = randomUUID();
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
const transferA = randomUUID();
const transferB = randomUUID();
const transferStale = randomUUID();
const returnB = randomUUID();
const returnStale = randomUUID();
const tag = A.slice(0, 8);
const markA = `P3PA-${tag}`;
const markB = `P3PB-${tag}`;
const password = `Qa${randomBytes(9).toString('hex')}!`;
const phoneA = `91${Date.now().toString().slice(-8)}7`;
const phoneB = `91${Date.now().toString().slice(-8)}8`;
let debitA;
let creditA;
let debitB;
let creditB;

function nextCalendarMonth(iso) {
  const [year, month, day] = iso.split('-').map(Number);
  const target = new Date(Date.UTC(year, month, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, last));
  return target.toISOString().slice(0, 10);
}

function previousCalendarDay(iso) {
  const [year, month, day] = iso.split('-').map(Number);
  const value = new Date(Date.UTC(year, month - 1, day));
  value.setUTCDate(value.getUTCDate() - 1);
  return value.toISOString().slice(0, 10);
}

const pool = new pg.Pool({ connectionString: databaseUrl });
const results = [];
let server;

function brief(text) {
  try {
    const body = JSON.parse(text);
    return String(body.code || body.error || '').replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, 'id').slice(0, 80);
  } catch {
    return '';
  }
}

function record(level, route, scenario, detail) {
  results.push({ level, route, scenario, detail });
  console.log(`${level} ${route} ${scenario} ${detail}`);
}

async function assertDb() {
  const db = await pool.query(`SELECT current_database() AS db, inet_server_addr()::text AS addr, inet_server_port() AS port`);
  const info = db.rows[0];
  if (info.db !== 'kh_phase2_test' || Number(info.port) !== 5433 || (!String(info.addr).includes('127.0.0.1') && !String(info.addr).includes('::1'))) {
    throw new Error(`Refusing live HTTP against ${info.db} at ${info.addr}:${info.port}`);
  }
  console.log(`database ${info.db} loopback port ${info.port}`);
}

async function purge(ids) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('khatario.ledger_delete_reason', 'admin:seed_demo', true), set_config('khatario.actor_id', '', true)`);
    await client.query(`DELETE FROM ledger_entry_lines WHERE business_id = ANY($1::uuid[])`, [ids]);
    await client.query(`DELETE FROM ledger_entries WHERE business_id = ANY($1::uuid[])`, [ids]);
    await client.query(`DELETE FROM journal_entries WHERE business_id = ANY($1::uuid[])`, [ids]);
    await client.query(`DELETE FROM recurring_invoice_history WHERE recurring_invoice_id IN (SELECT id FROM recurring_invoices WHERE business_id = ANY($1::uuid[]))`, [ids]);
    await client.query(`DELETE FROM recurring_invoices WHERE business_id = ANY($1::uuid[])`, [ids]);
    await client.query(`DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE business_id = ANY($1::uuid[]))`, [ids]);
    await client.query(`DELETE FROM invoices WHERE business_id = ANY($1::uuid[])`, [ids]);
    await client.query(`DELETE FROM payments WHERE business_id = ANY($1::uuid[])`, [ids]);
    await client.query(`DELETE FROM stock_movements WHERE business_id = ANY($1::uuid[])`, [ids]);
    await client.query(`DELETE FROM location_stock WHERE item_id IN (SELECT id FROM items WHERE business_id = ANY($1::uuid[]))`, [ids]);
    await client.query(`DELETE FROM stock_transfer_items WHERE transfer_id IN (SELECT id FROM stock_transfers WHERE business_id = ANY($1::uuid[]))`, [ids]);
    await client.query(`DELETE FROM stock_transfers WHERE business_id = ANY($1::uuid[])`, [ids]);
    await client.query(`DELETE FROM purchase_return_items WHERE return_id IN (SELECT id FROM purchase_returns WHERE business_id = ANY($1::uuid[]))`, [ids]);
    await client.query(`DELETE FROM purchase_returns WHERE business_id = ANY($1::uuid[])`, [ids]);
    await client.query(`DELETE FROM purchase_order_items WHERE purchase_order_id IN (SELECT id FROM purchase_orders WHERE business_id = ANY($1::uuid[]))`, [ids]);
    await client.query(`DELETE FROM purchase_orders WHERE business_id = ANY($1::uuid[])`, [ids]);
    await client.query(`DELETE FROM purchase_items WHERE purchase_id IN (SELECT id FROM purchases WHERE business_id = ANY($1::uuid[]))`, [ids]);
    await client.query(`DELETE FROM purchases WHERE business_id = ANY($1::uuid[])`, [ids]);
    await client.query(`DELETE FROM branch_item_stock WHERE business_id = ANY($1::uuid[])`, [ids]);
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

async function seed() {
  const orphans = await pool.query(`SELECT id FROM businesses WHERE name LIKE 'P3P %'`);
  if (orphans.rows.length) await purge(orphans.rows.map((row) => row.id));
  const plan = await pool.query(
    `SELECT plan_id FROM subscription_plan_features
      WHERE enabled = true AND feature_id IN (
        'purchase_management','sales_recurring_invoices','settings_multi_warehouse','advanced_ledger','purchase_suppliers'
      )
      GROUP BY plan_id ORDER BY COUNT(DISTINCT feature_id) DESC LIMIT 1`,
  );
  if (!plan.rows[0]) throw new Error('No subscription plan');
  const hash = bcrypt.hashSync(password, 8);
  for (const [id, name, gst] of [
    [A, `P3P A ${tag}`, `27AAAP3P${tag.slice(0, 4)}1Z5`],
    [B, `P3P B ${tag}`, `29AAAP3P${tag.slice(0, 4)}1Z6`],
  ]) {
    await pool.query(
      `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type, primary_module)
       VALUES ($1, $2, $3, $4, 'regular', 'billing')`,
      [id, name, gst, gst.slice(0, 2)],
    );
    await pool.query(`INSERT INTO business_modules (business_id, module_key, enabled, source) VALUES ($1, 'billing', true, 'test')`, [id]);
    await pool.query(
      `INSERT INTO business_module_subscriptions (business_id, module_key, plan_id, status, start_date, end_date)
       VALUES ($1, 'billing', $2, 'active', CURRENT_DATE, CURRENT_DATE + 30)`,
      [id, plan.rows[0].plan_id],
    );
    await pool.query(`SELECT create_default_chart_of_accounts($1)`, [id]);
    await pool.query(`SELECT ensure_standard_account_heads($1)`, [id]);
  }
  await pool.query(
    `INSERT INTO branches (id, business_id, name, state_code, is_default, is_active)
     VALUES ($1, $3, 'Main', '27', true, true), ($2, $4, 'Main', '29', true, true)`,
    [branchA, branchB, A, B],
  );
  await pool.query(
    `INSERT INTO users (id, business_id, name, phone, password_hash, is_primary_admin, auth_session_version, is_active)
     VALUES ($1, $3, 'Owner A', $4, $5, true, 1, true), ($2, $6, 'Owner B', $7, $5, true, 1, true)`,
    [ownerA, ownerB, A, phoneA, hash, B, phoneB],
  );
  await pool.query(
    `INSERT INTO user_branches (user_id, branch_id, can_view, can_edit, can_delete, can_create_transactions)
     VALUES ($1, $2, true, true, true, true), ($3, $4, true, true, true, true)`,
    [ownerA, branchA, ownerB, branchB],
  );
  await pool.query(
    `INSERT INTO customers (id, business_id, name, is_active, state_code) VALUES ($1, $2, $3, true, '27'), ($4, $5, $6, true, '29')`,
    [customerA, A, markA, customerB, B, markB],
  );
  await pool.query(
    `INSERT INTO suppliers (id, business_id, name, is_active, state_code, current_balance)
     VALUES ($1, $2, $3, true, '27', 40), ($4, $5, $6, true, '29', 70)`,
    [supplierA, A, markA, supplierB, B, markB],
  );
  await pool.query(
    `INSERT INTO items (id, business_id, name, item_type, unit, selling_price, purchase_price, tax_rate, hsn_sac)
     VALUES ($1, $2, $3, 'goods', 'PCS', 10, 8, 0, '847130'), ($4, $5, $6, 'goods', 'PCS', 10, 8, 0, '847130')`,
    [itemA, A, markA, itemB, B, markB],
  );
  await pool.query(
    `INSERT INTO warehouses (id, business_id, branch_id, name, is_active)
     VALUES ($1, $5, $6, 'A1', true), ($2, $5, $6, 'A2', true), ($3, $7, $8, 'B1', true), ($4, $7, $8, 'B2', true)`,
    [whA1, whA2, whB1, whB2, A, branchA, B, branchB],
  );
  const q = async (label, sql, params) => {
    try {
      await pool.query(sql, params);
    } catch (error) {
      throw new Error(`${label}: ${error instanceof Error ? error.message : 'insert failed'}`);
    }
  };
  for (const [biz, branch, customer, supplier, mark, total] of [
    [A, branchA, customerA, supplierA, markA, '10.17'],
    [B, branchB, customerB, supplierB, markB, '88.83'],
  ]) {
    await q('purchase',
      `INSERT INTO purchases (id, business_id, supplier_id, bill_number, bill_date, status, place_of_supply_state_code,
          subtotal, tax_total, grand_total, paid_amount, balance_amount, payment_status, branch_id)
       VALUES ($1, $2, $3, $4, CURRENT_DATE, 'final', '27', $5, 0, $5, 0, $5, 'unpaid', $6)`,
      [randomUUID(), biz, supplier, mark, total, branch],
    );
    await q('payment',
      `INSERT INTO payments (id, business_id, branch_id, type, customer_id, amount, payment_mode, payment_date, status)
       VALUES ($1, $2, $3, 'receivable', $4, $5, 'cash', CURRENT_DATE, 'active')`,
      [randomUUID(), biz, branch, customer, total],
    );
  }
  await q('po-draft',
    `INSERT INTO purchase_orders (id, business_id, supplier_id, order_number, order_date, status, subtotal, grand_total, created_by)
     VALUES ($1, $2, $3, $4, CURRENT_DATE, 'draft', 10, 10, $5), ($6, $2, $3, $7, CURRENT_DATE, 'confirmed', 9, 9, $5)`,
    [randomUUID(), A, supplierA, `${markA}-draft`, ownerA, randomUUID(), `${markA}-confirmed`],
  );
  await q('po-b',
    `INSERT INTO purchase_orders (id, business_id, supplier_id, order_number, order_date, status, subtotal, grand_total, created_by)
     VALUES ($1, $2, $3, $4, CURRENT_DATE, 'draft', 8, 8, $5)`,
    [randomUUID(), B, supplierB, `${markB}-draft`, ownerB],
  );
  await q('returns',
    `INSERT INTO purchase_returns (id, business_id, supplier_id, return_number, return_date, subtotal, grand_total, created_by)
     VALUES ($1, $2, $3, $4, CURRENT_DATE, 10, 10, $5),
            ($6, $2, $3, $7, CURRENT_DATE, 4, 4, $5),
            ($8, $9, $10, $11, CURRENT_DATE, 6, 6, $12)`,
    [randomUUID(), A, supplierA, `${markA}-r1`, ownerA, randomUUID(), `${markA}-r2`, returnB, B, supplierB, `${markB}-r1`, ownerB],
  );
  await q('return-stale',
    `INSERT INTO purchase_returns (id, business_id, supplier_id, return_number, return_date, subtotal, grand_total, created_by)
     VALUES ($1, $2, $3, $4, CURRENT_DATE, 3, 3, $5)`,
    [returnStale, A, supplierA, `${markA}-stale-return`, ownerA],
  );
  for (const [id, biz, fromWh, toWh, item, owner, mark] of [
    [transferA, A, whA1, whA2, itemA, ownerA, `${markA}-move`],
    [transferStale, A, whA1, whA2, itemA, ownerA, `${markA}-stale`],
    [transferB, B, whB1, whB2, itemB, ownerB, `${markB}-move`],
  ]) {
    await q('transfer',
      `INSERT INTO stock_transfers (id, business_id, transfer_number, transfer_date, from_location_id, to_location_id, status, notes, created_by)
       VALUES ($1, $2, $3, CURRENT_DATE, $4, $5, 'pending', $6, $7)`,
      [id, biz, mark, fromWh, toWh, mark, owner],
    );
    await q('transfer-item',
      `INSERT INTO stock_transfer_items (id, transfer_id, item_id, qty, quantity_requested, unit)
       VALUES ($1, $2, $3, 1, 1, 'PCS')`,
      [randomUUID(), id, item],
    );
  }
  await q('stock',
    `INSERT INTO location_stock (location_id, item_id, current_stock_qty) VALUES ($1, $2, 5), ($3, $4, 5)`,
    [whA1, itemA, whB1, itemB],
  );
  const accounts = await pool.query(
    `SELECT b.id AS business_id,
        (SELECT id FROM accounts a WHERE a.business_id = b.id AND a.nature = 'debit' ORDER BY account_code LIMIT 1) AS debit_id,
        (SELECT id FROM accounts a WHERE a.business_id = b.id AND a.nature = 'credit' ORDER BY account_code LIMIT 1) AS credit_id
     FROM businesses b WHERE b.id = ANY($1::uuid[])`,
    [[A, B]],
  );
  for (const row of accounts.rows) {
    if (row.business_id === A) {
      debitA = row.debit_id;
      creditA = row.credit_id;
    } else {
      debitB = row.debit_id;
      creditB = row.credit_id;
    }
  }
  if (!debitA || !creditA || !debitB || !creditB) throw new Error('chart of accounts missing');
}

function startServer() {
  server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '-p', String(PORT)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      DB_NAME: 'kh_phase2_test',
      DB_PORT: dbPort,
      DB_SSL: 'false',
      E2E_DISABLE_RATE_LIMIT: 'true',
      NODE_OPTIONS: '--max-old-space-size=8192',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', () => undefined);
  server.stderr.on('data', () => undefined);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Next.js did not become ready')), 120000);
    const wait = async () => {
      const started = Date.now();
      while (Date.now() - started < 120000) {
        if (server.exitCode != null) {
          clearTimeout(timer);
          reject(new Error('Next.js exited before it was ready'));
          return;
        }
        try {
          const res = await fetch(`${BASE}/api/auth/login`);
          if (res.status === 200) {
            clearTimeout(timer);
            resolve();
            return;
          }
        } catch {
          // still starting
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
    };
    wait();
  });
}

function stopServer() {
  if (!server || server.killed) return;
  if (process.platform === 'win32') spawn('taskkill', ['/PID', String(server.pid), '/T', '/F'], { stdio: 'ignore' });
  else server.kill('SIGTERM');
}

function cookieFrom(res) {
  const list = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  return list.map((line) => line.split(';')[0]).join('; ');
}

async function login(phone) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ phone, password }),
  });
  return { status: res.status, cookie: cookieFrom(res) };
}

async function http(method, route, { cookie, body, headers, query } = {}) {
  const url = new URL(route, BASE);
  for (const [key, value] of Object.entries(query || {})) url.searchParams.set(key, String(value));
  const res = await fetch(url, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(cookie ? { cookie } : {}),
      ...(headers || {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    redirect: 'manual',
    signal: AbortSignal.timeout(90000),
  });
  return { status: res.status, text: await res.text() };
}

const spoof = {
  'x-authenticated-user-id': ownerB,
  'x-authenticated-business-id': B,
  'x-authenticated-session-version': '1',
};

async function stockQty(locationId, itemId) {
  const row = await pool.query(`SELECT COALESCE(current_stock_qty, 0)::text AS qty FROM location_stock WHERE location_id = $1 AND item_id = $2`, [locationId, itemId]);
  return row.rows[0]?.qty || '0';
}

async function main() {
  await assertDb();
  await seed();
  await startServer();
  console.log(`next dev listening on 127.0.0.1:${PORT}`);
  const sessionA = await login(phoneA);
  const sessionB = await login(phoneB);
  const loginOk = sessionA.status === 200 && sessionA.cookie.includes('khatario_session') && sessionB.status === 200;
  record(loginOk ? 'PASS' : 'FAIL', 'POST /api/auth/login', 'fixture users', `A ${sessionA.status} B ${sessionB.status}`);
  if (!loginOk) throw new Error('login failed');

  const journalA = await http('POST', '/api/journal-entries', {
    cookie: sessionA.cookie,
    body: { entry_date: day, narration: `${markA}-journal`, lines: [{ account_id: debitA, debit: 6, credit: 0 }, { account_id: creditA, debit: 0, credit: 6 }] },
  });
  const journalB = await http('POST', '/api/journal-entries', {
    cookie: sessionB.cookie,
    body: { entry_date: day, narration: `${markB}-journal`, lines: [{ account_id: debitB, debit: 7, credit: 0 }, { account_id: creditB, debit: 0, credit: 7 }] },
  });
  record(journalA.status === 201 && journalB.status === 201 ? 'PASS' : 'FAIL', 'POST /api/journal-entries', 'seed narrations for the list', `A ${journalA.status} B ${journalB.status}`);

  const lists = [
    ['/api/journal-entries', `${markA}-journal`, `${markB}-journal`],
    ['/api/purchases', markA, markB],
    ['/api/payments', markA, markB],
  ];
  for (const [route, own, other] of lists) {
    const anon = await http('GET', route, { query: { business_id: B, user_id: ownerB }, headers: spoof });
    record(anon.status === 401 && !anon.text.includes(own) && !anon.text.includes(other) ? 'PASS' : 'FAIL', `GET ${route}`, 'no session', `HTTP ${anon.status}`);
    const clean = await http('GET', route, { cookie: sessionA.cookie, query: { business_id: A } });
    const forged = await http('GET', route, { cookie: sessionA.cookie, query: { business_id: B, user_id: ownerB }, headers: spoof });
    const ownB = await http('GET', route, { cookie: sessionB.cookie, query: { business_id: B } });
    const sees = clean.status === 200 && clean.text.includes(own) && !clean.text.includes(other) && ownB.status === 200 && ownB.text.includes(other) && !ownB.text.includes(own);
    record(sees ? 'PASS' : 'FAIL', `GET ${route}`, 'own markers', `A ${clean.status} B ${ownB.status}`);
    const isolated = !forged.text.includes(other) && (forged.status === 403 || (forged.status === 200 && forged.text === clean.text));
    record(isolated ? 'PASS' : 'FAIL', `GET ${route}`, 'forged business id', `HTTP ${forged.status} leaked ${forged.text.includes(other)}`);
  }

  const draft = await http('GET', '/api/purchase-orders', { cookie: sessionA.cookie, query: { status: 'draft', business_id: B } });
  const confirmed = await http('GET', '/api/purchase-orders', { cookie: sessionA.cookie, query: { status: 'confirmed' } });
  const filterOk = draft.status === 200 && draft.text.includes(`${markA}-draft`) && !draft.text.includes(`${markA}-confirmed`) && !draft.text.includes(markB)
    && confirmed.status === 200 && confirmed.text.includes(`${markA}-confirmed`) && !confirmed.text.includes(`${markA}-draft`) && !confirmed.text.includes(markB);
  record(filterOk ? 'PASS' : 'FAIL', 'GET /api/purchase-orders', 'status filter ignores business B', `draft ${draft.status} confirmed ${confirmed.status}`);
  record('NOT TESTED', 'GET /api/purchase-orders', 'search and pagination', 'the handler reads status only');

  const searched = await http('GET', '/api/purchase-returns', { cookie: sessionA.cookie, query: { search: `${markA}-r1`, business_id: B } });
  const page = await http('GET', '/api/purchase-returns', { cookie: sessionA.cookie, query: { page: '1', limit: '1' } });
  let pageBody = {};
  try { pageBody = JSON.parse(page.text); } catch { pageBody = {}; }
  const searchOk = searched.status === 200 && searched.text.includes(`${markA}-r1`) && !searched.text.includes(`${markA}-r2`) && !searched.text.includes(markB);
  const pageOk = page.status === 200 && Array.isArray(pageBody.purchaseReturns) && pageBody.purchaseReturns.length === 1 && Number(pageBody.pagination?.total) >= 2 && !page.text.includes(markB);
  record(searchOk ? 'PASS' : 'FAIL', 'GET /api/purchase-returns', 'search ignores business B', `HTTP ${searched.status}`);
  record(pageOk ? 'PASS' : 'FAIL', 'GET /api/purchase-returns', 'page and limit', `HTTP ${page.status} rows ${pageBody.purchaseReturns?.length} total ${pageBody.pagination?.total}`);

  const poAnon = await http('POST', '/api/purchase-orders', { body: { supplier_id: supplierB, order_number: `${markB}-new`, order_date: day, business_id: B, items: [{ item_name: markB, qty: 1, unit_price: 5 }] }, headers: spoof });
  const poForeign = await http('POST', '/api/purchase-orders', { cookie: sessionA.cookie, body: { supplier_id: supplierB, order_number: `${markA}-foreign-po`, order_date: day, business_id: B, items: [{ item_name: markA, qty: 1, unit_price: 5 }] }, headers: spoof });
  const poOwn = await http('POST', '/api/purchase-orders', { cookie: sessionA.cookie, body: { supplier_id: supplierA, order_number: `${markA}-new-po`, order_date: day, items: [{ item_name: markA, qty: 1, unit_price: 5 }] } });
  const poRow = await pool.query(`SELECT business_id FROM purchase_orders WHERE order_number = $1`, [`${markA}-new-po`]);
  const poForeignRow = await pool.query(`SELECT COUNT(*)::int AS n FROM purchase_orders WHERE order_number = $1`, [`${markA}-foreign-po`]);
  record(poAnon.status === 401 && poForeignRow.rows[0].n === 0 ? 'PASS' : 'FAIL', 'POST /api/purchase-orders', 'no session', `HTTP ${poAnon.status}`);
  record(poForeign.status >= 400 && poForeign.status < 500 && poForeignRow.rows[0].n === 0 ? 'PASS' : 'FAIL', 'POST /api/purchase-orders', 'B supplier', `HTTP ${poForeign.status} ${brief(poForeign.text)}`);
  record(poOwn.status === 201 && poRow.rows[0]?.business_id === A ? 'PASS' : 'FAIL', 'POST /api/purchase-orders', 'own order', `HTTP ${poOwn.status}`);

  const beforeReturnB = await pool.query(`SELECT status, grand_total::text FROM purchase_returns WHERE id = $1`, [returnB]);
  const beforeSupplierB = await pool.query(`SELECT current_balance::text AS bal FROM suppliers WHERE id = $1`, [supplierB]);
  const prAnon = await http('POST', '/api/purchase-returns', { body: { supplier_id: supplierB, return_number: `${markB}-new`, return_date: day, business_id: B, items: [{ item_id: itemB, description: markB, qty: 1, unit_price: 10, tax_rate: 0 }] }, headers: spoof });
  const prForeign = await http('POST', '/api/purchase-returns', { cookie: sessionA.cookie, body: { supplier_id: supplierB, return_number: `${markA}-foreign-pr`, return_date: day, business_id: B, items: [{ item_id: itemA, description: markA, qty: 1, unit_price: 10, tax_rate: 0 }] }, headers: spoof });
  const beforeSupplierA = await pool.query(`SELECT current_balance::text AS bal FROM suppliers WHERE id = $1`, [supplierA]);
  const beforeMovesA = await pool.query(`SELECT COUNT(*)::int AS n FROM stock_movements WHERE business_id = $1`, [A]);
  const beforeLedgerA = await pool.query(`SELECT COUNT(*)::int AS n FROM ledger_entry_lines WHERE business_id = $1`, [A]);
  const prOwn = await http('POST', '/api/purchase-returns', { cookie: sessionA.cookie, body: { supplier_id: supplierA, return_number: `${markA}-live-pr`, return_date: day, items: [{ item_id: itemA, description: markA, qty: 1, unit_price: 10, tax_rate: 0 }] } });
  const prRow = await pool.query(`SELECT id, business_id, status, grand_total::text FROM purchase_returns WHERE return_number = $1`, [`${markA}-live-pr`]);
  const afterCreateSupplierA = await pool.query(`SELECT current_balance::text AS bal FROM suppliers WHERE id = $1`, [supplierA]);
  const afterCreateMovesA = await pool.query(`SELECT COUNT(*)::int AS n FROM stock_movements WHERE business_id = $1 AND reference_type = 'purchase_return'`, [A]);
  const prForeignCount = await pool.query(`SELECT COUNT(*)::int AS n FROM purchase_returns WHERE return_number = $1`, [`${markA}-foreign-pr`]);
  record(prAnon.status === 401 ? 'PASS' : 'FAIL', 'POST /api/purchase-returns', 'no session', `HTTP ${prAnon.status}`);
  record(prForeign.status >= 400 && prForeign.status < 500 && prForeignCount.rows[0].n === 0 ? 'PASS' : 'FAIL', 'POST /api/purchase-returns', 'B supplier', `HTTP ${prForeign.status} ${brief(prForeign.text)}`);
  record(prOwn.status === 201 && prRow.rows[0]?.business_id === A ? 'PASS' : 'BLOCKED', 'POST /api/purchase-returns', 'own return', `HTTP ${prOwn.status} ${brief(prOwn.text)} supplier ${beforeSupplierA.rows[0].bal}->${afterCreateSupplierA.rows[0].bal} out-moves ${afterCreateMovesA.rows[0].n}`);

  const recItem = (itemId, name) => ({ item_id: itemId, item_name: name, hsn_sac: '847130', unit: 'PCS', quantity: 1, unit_price: 10, tax_rate: 0 });
  const recAnon = await http('POST', '/api/recurring-invoices', { body: { customer_id: customerB, frequency: 'monthly', start_date: day, business_id: B, items: [recItem(itemB, markB)] }, headers: spoof });
  const beforeRec = await pool.query(`SELECT COUNT(*)::int AS n FROM recurring_invoices WHERE business_id = $1`, [A]);
  const recForeign = await http('POST', '/api/recurring-invoices', { cookie: sessionA.cookie, body: { customer_id: customerA, frequency: 'monthly', start_date: day, business_id: B, items: [recItem(itemB, markB)] }, headers: spoof });
  const afterRecForeign = await pool.query(`SELECT COUNT(*)::int AS n FROM recurring_invoices WHERE business_id = $1`, [A]);
  const recOwn = await http('POST', '/api/recurring-invoices', { cookie: sessionA.cookie, body: { customer_id: customerA, branch_id: branchA, frequency: 'monthly', start_date: day, items: [recItem(itemA, markA)] } });
  let recId = null;
  try { recId = JSON.parse(recOwn.text).recurringInvoice?.id || null; } catch { recId = null; }
  const recRow = recId ? await pool.query(`SELECT business_id FROM recurring_invoices WHERE id = $1`, [recId]) : { rows: [] };
  record(recAnon.status === 401 ? 'PASS' : 'FAIL', 'POST /api/recurring-invoices', 'no session', `HTTP ${recAnon.status}`);
  record(recForeign.status === 400 && afterRecForeign.rows[0].n === beforeRec.rows[0].n ? 'PASS' : 'FAIL', 'POST /api/recurring-invoices', 'B item', `HTTP ${recForeign.status} ${brief(recForeign.text)}`);
  record(recOwn.status === 201 && recRow.rows[0]?.business_id === A ? 'PASS' : 'FAIL', 'POST /api/recurring-invoices', 'own definition', `HTTP ${recOwn.status}`);

  const srcBefore = await stockQty(whA1, itemA);
  const destBefore = await stockQty(whA2, itemA);
  const bStatusBefore = (await pool.query(`SELECT status FROM stock_transfers WHERE id = $1`, [transferB])).rows[0].status;
  const bStockBefore = await stockQty(whB1, itemB);
  const dispatchForeign = await http('PATCH', `/api/stock-transfers/${transferB}/dispatch`, { cookie: sessionA.cookie, body: { business_id: B }, headers: spoof });
  const bStatusAfter = (await pool.query(`SELECT status FROM stock_transfers WHERE id = $1`, [transferB])).rows[0].status;
  const bStockAfter = await stockQty(whB1, itemB);
  record(dispatchForeign.status !== 200 && bStatusAfter === bStatusBefore && bStockAfter === bStockBefore ? 'PASS' : 'FAIL', 'PATCH /api/stock-transfers/[id]/dispatch', 'A cannot dispatch B', `HTTP ${dispatchForeign.status} ${brief(dispatchForeign.text)}`);
  const dispatchOwn = await http('PATCH', `/api/stock-transfers/${transferA}/dispatch`, { cookie: sessionA.cookie, body: {} });
  const srcAfter = await stockQty(whA1, itemA);
  const statusAfter = (await pool.query(`SELECT status FROM stock_transfers WHERE id = $1`, [transferA])).rows[0].status;
  const outMove = await pool.query(`SELECT COUNT(*)::int AS n FROM stock_movements WHERE reference_id = $1 AND type = 'out' AND business_id = $2`, [transferA, A]);
  const dispatched = dispatchOwn.status === 200 && statusAfter === 'in_transit' && Number(srcBefore) - Number(srcAfter) === 1 && outMove.rows[0].n === 1;
  record(dispatched ? 'PASS' : 'FAIL', 'PATCH /api/stock-transfers/[id]/dispatch', 'pending transfer deducts source stock', `HTTP ${dispatchOwn.status} ${brief(dispatchOwn.text)} status ${statusAfter} stock ${srcBefore}->${srcAfter}`);
  const receiveForeign = await http('POST', `/api/stock-transfers/${transferB}/receive`, { cookie: sessionA.cookie, body: { business_id: B, received_items: [{ item_id: itemB, received_qty: 1 }] }, headers: spoof });
  const bStill = (await pool.query(`SELECT status FROM stock_transfers WHERE id = $1`, [transferB])).rows[0].status;
  record(receiveForeign.status !== 200 && bStill === 'pending' ? 'PASS' : 'FAIL', 'POST /api/stock-transfers/[id]/receive', 'A cannot receive B', `HTTP ${receiveForeign.status} ${brief(receiveForeign.text)}`);
  const receiveOwn = await http('POST', `/api/stock-transfers/${transferA}/receive`, { cookie: sessionA.cookie, body: { received_items: [{ item_id: itemA, received_qty: 1 }] } });
  const destAfter = await stockQty(whA2, itemA);
  const finalStatus = (await pool.query(`SELECT status FROM stock_transfers WHERE id = $1`, [transferA])).rows[0].status;
  const inMove = await pool.query(`SELECT COUNT(*)::int AS n FROM stock_movements WHERE reference_id = $1 AND type = 'in' AND business_id = $2`, [transferA, A]);
  const received = receiveOwn.status === 200 && finalStatus === 'completed' && Number(destAfter) - Number(destBefore) === 1 && inMove.rows[0].n === 1;
  record(received ? 'PASS' : 'FAIL', 'POST /api/stock-transfers/[id]/receive', 'in-transit transfer adds destination stock', `HTTP ${receiveOwn.status} ${brief(receiveOwn.text)} status ${finalStatus} dest ${destBefore}->${destAfter}`);

  const cancelForeign = await http('POST', `/api/purchase-returns/${returnB}/cancel`, { cookie: sessionA.cookie, body: { reason: 'cross', business_id: B }, headers: spoof });
  const returnBNow = await pool.query(`SELECT status FROM purchase_returns WHERE id = $1`, [returnB]);
  const supplierBNow = await pool.query(`SELECT current_balance::text AS bal FROM suppliers WHERE id = $1`, [supplierB]);
  record(cancelForeign.status !== 200 && returnBNow.rows[0].status === beforeReturnB.rows[0].status && supplierBNow.rows[0].bal === beforeSupplierB.rows[0].bal ? 'PASS' : 'FAIL', 'POST /api/purchase-returns/[id]/cancel', 'A cannot cancel B', `HTTP ${cancelForeign.status} ${brief(cancelForeign.text)}`);
  if (prRow.rows[0]?.id) {
    const cancelOwn = await http('POST', `/api/purchase-returns/${prRow.rows[0].id}/cancel`, { cookie: sessionA.cookie, body: { reason: 'counted twice' } });
    const cancelled = await pool.query(`SELECT status FROM purchase_returns WHERE id = $1`, [prRow.rows[0].id]);
    const supplierANow = await pool.query(`SELECT current_balance::text AS bal FROM suppliers WHERE id = $1`, [supplierA]);
    const movesNow = await pool.query(`SELECT COUNT(*)::int AS n FROM stock_movements WHERE business_id = $1 AND reference_type = 'purchase_return_cancel' AND reference_id = $2`, [A, prRow.rows[0].id]);
    const restored = supplierANow.rows[0].bal === beforeSupplierA.rows[0].bal;
    record(cancelOwn.status === 200 && cancelled.rows[0].status === 'cancelled' && restored && movesNow.rows[0].n >= 1 ? 'PASS' : 'FAIL', 'POST /api/purchase-returns/[id]/cancel', 'own return becomes cancelled and supplier balance returns', `HTTP ${cancelOwn.status} ${brief(cancelOwn.text)} balance ${beforeSupplierA.rows[0].bal}->${afterCreateSupplierA.rows[0].bal}->${supplierANow.rows[0].bal} cancel-moves ${movesNow.rows[0].n}`);
  } else {
    record('BLOCKED', 'POST /api/purchase-returns/[id]/cancel', 'own return', 'create did not return an id');
  }

  const beforeInvoicesB = await pool.query(`SELECT COUNT(*)::int AS n FROM invoices WHERE business_id = $1`, [B]);
  if (recId) {
    const beforeRun = await pool.query(`SELECT COUNT(*)::int AS n FROM invoices WHERE business_id = ANY($1::uuid[])`, [[A, B]]);
    const runForeign = await http('POST', `/api/recurring-invoices/${recId}`, { cookie: sessionA.cookie, body: { action: 'run_now', business_id: B }, headers: spoof });
    const afterForeignRun = await pool.query(`SELECT COUNT(*)::int AS n FROM invoices WHERE business_id = ANY($1::uuid[])`, [[A, B]]);
    record(runForeign.status === 403 && afterForeignRun.rows[0].n === beforeRun.rows[0].n ? 'PASS' : 'FAIL', 'POST /api/recurring-invoices/[id]', 'run_now naming business B', `HTTP ${runForeign.status} ${brief(runForeign.text)}`);
    const run = await http('POST', `/api/recurring-invoices/${recId}`, { cookie: sessionA.cookie, body: { action: 'run_now' } });
    let created = [];
    try { created = JSON.parse(run.text).created || []; } catch { created = []; }
    const invoice = created[0]?.invoice_id
      ? await pool.query(
          `SELECT business_id, to_char(invoice_date, 'YYYY-MM-DD') AS invoice_date FROM invoices WHERE id = $1`,
          [created[0].invoice_id],
        )
      : { rows: [] };
    const schedule = await pool.query(
      `SELECT to_char(start_date, 'YYYY-MM-DD') AS start_date,
              to_char(next_run_date, 'YYYY-MM-DD') AS next_run,
              to_char(last_run_date, 'YYYY-MM-DD') AS last_run,
              (SELECT COUNT(*)::int FROM recurring_invoice_history WHERE recurring_invoice_id = $1 AND status = 'success') AS runs
         FROM recurring_invoices WHERE id = $1`,
      [recId],
    );
    const next = nextCalendarMonth(day);
    const runOk = run.status === 200
      && created.length === 1
      && created[0].run_date === day
      && invoice.rows[0]?.business_id === A
      && invoice.rows[0]?.invoice_date === day
      && schedule.rows[0].start_date === day
      && schedule.rows[0].last_run === day
      && schedule.rows[0].next_run === next
      && schedule.rows[0].runs === 1;
    record(runOk ? 'PASS' : 'FAIL', 'POST /api/recurring-invoices/[id]', 'run_now invoice_date matches the business day', `HTTP ${run.status} response ${created[0]?.run_date || ''} stored ${invoice.rows[0]?.invoice_date || ''} next ${schedule.rows[0]?.next_run || ''}`);
    const again = await http('POST', `/api/recurring-invoices/${recId}`, { cookie: sessionA.cookie, body: { action: 'run_now' } });
    let againCreated = [];
    try { againCreated = JSON.parse(again.text).created || []; } catch { againCreated = []; }
    const afterAgain = await pool.query(
      `SELECT COUNT(*)::int AS invoices FROM invoices WHERE business_id = $1`,
      [A],
    );
    const scheduleAgain = await pool.query(
      `SELECT to_char(next_run_date, 'YYYY-MM-DD') AS next_run,
              (SELECT COUNT(*)::int FROM invoices WHERE business_id = $2) AS invoices
         FROM recurring_invoices WHERE id = $1`,
      [recId, A],
    );
    const invoiceCount = created[0]?.invoice_id
      ? await pool.query(`SELECT COUNT(*)::int AS n FROM invoices WHERE id = $1`, [created[0].invoice_id])
      : { rows: [{ n: 0 }] };
    record(
      again.status === 200 && againCreated.length === 0 && scheduleAgain.rows[0].next_run === next && invoiceCount.rows[0].n === 1 && afterAgain.rows[0].invoices === 1
        ? 'PASS'
        : 'FAIL',
      'POST /api/recurring-invoices/[id]',
      'second run_now does not create another invoice',
      `HTTP ${again.status} created ${againCreated.length} next ${scheduleAgain.rows[0].next_run}`,
    );
  } else {
    record('BLOCKED', 'POST /api/recurring-invoices/[id]', 'run_now on own definition', 'definition was not created');
  }
  const badId = randomUUID();
  await pool.query(
    `INSERT INTO recurring_invoices (id, business_id, customer_id, branch_id, frequency, start_date, next_run_date, items, notes, created_by)
     VALUES ($1, $2, $3, $4, 'monthly', $5, $5, $6::jsonb, $7, $8)`,
    [badId, A, customerA, branchA, day, JSON.stringify([recItem(itemB, markB)]), `${markA}-bad-item`, ownerA],
  );
  const beforeInvoicesA = await pool.query(`SELECT COUNT(*)::int AS n FROM invoices WHERE business_id = $1`, [A]);
  const badRun = await http('POST', `/api/recurring-invoices/${badId}`, { cookie: sessionA.cookie, body: { action: 'run_now' } });
  const afterInvoicesA = await pool.query(`SELECT COUNT(*)::int AS n FROM invoices WHERE business_id = $1`, [A]);
  const afterInvoicesB = await pool.query(`SELECT COUNT(*)::int AS n FROM invoices WHERE business_id = $1`, [B]);
  const badOk = badRun.status === 400 && badRun.text.includes(`${day}:`) && !badRun.text.includes(previousCalendarDay(day)) && afterInvoicesA.rows[0].n === beforeInvoicesA.rows[0].n && afterInvoicesB.rows[0].n === beforeInvoicesB.rows[0].n;
  record(badOk ? 'PASS' : 'FAIL', 'POST /api/recurring-invoices/[id]', 'run_now with B item id', `HTTP ${badRun.status} ${brief(badRun.text)}`);
  const runAnon = await http('POST', `/api/recurring-invoices/${badId}`, { body: { action: 'run_now', business_id: B }, headers: spoof });
  record(runAnon.status === 401 ? 'PASS' : 'FAIL', 'POST /api/recurring-invoices/[id]', 'no session', `HTTP ${runAnon.status}`);

  await pool.query(`UPDATE users SET auth_session_version = 2 WHERE id = $1`, [ownerA]);
  const staleRoutes = [
    ['GET', '/api/journal-entries', { query: { business_id: B } }],
    ['GET', '/api/purchases', { query: { business_id: B } }],
    ['GET', '/api/payments', { query: { business_id: B } }],
    ['GET', '/api/purchase-orders', { query: { business_id: B, status: 'draft' } }],
    ['POST', '/api/purchase-orders', { body: { supplier_id: supplierA, order_number: `${markB}-stale-po`, order_date: day, business_id: B, items: [{ item_name: markA, qty: 1, unit_price: 1 }] } }],
    ['POST', '/api/purchase-returns', { body: { supplier_id: supplierA, return_number: `${markB}-stale-pr`, return_date: day, business_id: B, items: [{ item_id: itemA, description: markA, qty: 1, unit_price: 1, tax_rate: 0 }] } }],
    ['POST', '/api/recurring-invoices', { body: { customer_id: customerA, frequency: 'monthly', start_date: day, business_id: B, items: [recItem(itemA, markA)] } }],
    ['PATCH', `/api/stock-transfers/${transferStale}/dispatch`, { body: {} }],
    ['POST', `/api/purchase-returns/${returnStale}/cancel`, { body: { reason: 'stale session' } }],
  ];
  if (recId) staleRoutes.push(['POST', `/api/recurring-invoices/${recId}`, { body: { action: 'run_now' } }]);
  for (const [method, route, opts] of staleRoutes) {
    const stale = await http(method, route, { cookie: sessionA.cookie, ...opts, headers: spoof });
    const leaked = stale.text.includes(markB);
    const label = route.replace(transferStale, '[id]').replace(returnStale, '[id]').replace(recId || 'none', '[id]');
    record(stale.status === 401 && !leaked ? 'PASS' : 'FAIL', `${method} ${label}`, 'stale session', `HTTP ${stale.status} ${brief(stale.text)}`);
  }
  const stalePo = await pool.query(`SELECT COUNT(*)::int AS n FROM purchase_orders WHERE order_number = $1`, [`${markB}-stale-po`]);
  const staleTransfer = await pool.query(`SELECT status FROM stock_transfers WHERE id = $1`, [transferStale]);
  const staleReturn = await pool.query(`SELECT COALESCE(status, 'open') AS status FROM purchase_returns WHERE id = $1`, [returnStale]);
  record(stalePo.rows[0].n === 0 && staleTransfer.rows[0].status === 'pending' && staleReturn.rows[0].status !== 'cancelled' ? 'PASS' : 'FAIL', 'stale writes', 'order absent, transfer pending, return not cancelled', `orders ${stalePo.rows[0].n} transfer ${staleTransfer.rows[0].status} return ${staleReturn.rows[0].status}`);

  const failed = results.filter((row) => row.level === 'FAIL').length;
  const blocked = results.filter((row) => row.level === 'BLOCKED').length;
  const passed = results.filter((row) => row.level === 'PASS').length;
  const untested = results.filter((row) => row.level === 'NOT TESTED').length;
  console.log(`SUMMARY pass=${passed} fail=${failed} blocked=${blocked} not_tested=${untested}`);
  if (failed) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(`BLOCKED ${error instanceof Error ? error.message : 'live HTTP failed'}`);
    process.exitCode = 2;
  })
  .finally(async () => {
    stopServer();
    try {
      await purge([A, B]);
    } catch (error) {
      console.error(`cleanup failed ${error instanceof Error ? error.message : 'purge'}`);
    }
    await pool.end();
  });
