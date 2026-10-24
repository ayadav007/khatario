/**
 * Phase 3M live HTTP check. Starts Next.js against kh_phase2_test only.
 * Prints statuses and markers. Does not print cookies, passwords, or the database URL.
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
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    let val = m[2].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    out[m[1]] = val;
  }
  return out;
}

const envFile = readEnvFile(path.resolve(process.cwd(), '.env'));
const host = envFile.DB_HOST || '';
if (host !== 'localhost' && host !== '127.0.0.1' && host !== '::1') {
  console.error('BLOCKED database host is not local');
  process.exit(2);
}
const port = envFile.DB_PORT || '5432';
const databaseUrl = `postgresql://${encodeURIComponent(envFile.DB_USER)}:${encodeURIComponent(envFile.DB_PASSWORD)}@${host}:${port}/kh_phase2_test`;
const PORT = 3108;
const BASE = `http://127.0.0.1:${PORT}`;
const day = '2026-10-19';

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
const tag = A.slice(0, 8);
const markA = `P3MA-${tag}`;
const markB = `P3MB-${tag}`;
const password = `Qa${randomBytes(9).toString('hex')}!`;
const phoneA = `91${Date.now().toString().slice(-8)}1`;
const phoneB = `91${Date.now().toString().slice(-8)}2`;

const pool = new pg.Pool({ connectionString: databaseUrl });
const results = [];
let server;

function record(route, scenario, ok, detail) {
  results.push({ route, scenario, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${route} ${scenario} ${detail}`);
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
    await client.query(
      `SELECT set_config('khatario.ledger_delete_reason', 'admin:seed_demo', true), set_config('khatario.actor_id', '', true)`,
    );
    await client.query(`DELETE FROM ledger_entry_lines WHERE business_id = ANY($1::uuid[])`, [ids]);
    await client.query(`DELETE FROM ledger_entries WHERE business_id = ANY($1::uuid[])`, [ids]);
    await client.query(`DELETE FROM stock_movements WHERE business_id = ANY($1::uuid[])`, [ids]);
    await client.query(`DELETE FROM inventory_adjustments WHERE business_id = ANY($1::uuid[])`, [ids]);
    await client.query(`DELETE FROM stock_transfer_items WHERE transfer_id IN (SELECT id FROM stock_transfers WHERE business_id = ANY($1::uuid[]))`, [ids]);
    await client.query(`DELETE FROM stock_transfers WHERE business_id = ANY($1::uuid[])`, [ids]);
    await client.query(`DELETE FROM purchase_return_items WHERE return_id IN (SELECT id FROM purchase_returns WHERE business_id = ANY($1::uuid[]))`, [ids]);
    await client.query(`DELETE FROM purchase_returns WHERE business_id = ANY($1::uuid[])`, [ids]);
    await client.query(`DELETE FROM purchase_order_items WHERE purchase_order_id IN (SELECT id FROM purchase_orders WHERE business_id = ANY($1::uuid[]))`, [ids]);
    await client.query(`DELETE FROM purchase_orders WHERE business_id = ANY($1::uuid[])`, [ids]);
    await client.query(`DELETE FROM purchase_items WHERE purchase_id IN (SELECT id FROM purchases WHERE business_id = ANY($1::uuid[]))`, [ids]);
    await client.query(`DELETE FROM purchases WHERE business_id = ANY($1::uuid[])`, [ids]);
    await client.query(`DELETE FROM recurring_invoices WHERE business_id = ANY($1::uuid[])`, [ids]);
    await client.query(`DELETE FROM payments WHERE business_id = ANY($1::uuid[])`, [ids]);
    await client.query(`DELETE FROM expenses WHERE business_id = ANY($1::uuid[])`, [ids]);
    await client.query(`DELETE FROM estimate_items WHERE estimate_id IN (SELECT id FROM estimates WHERE business_id = ANY($1::uuid[]))`, [ids]);
    await client.query(`DELETE FROM estimates WHERE business_id = ANY($1::uuid[])`, [ids]);
    await client.query(`DELETE FROM sales_order_items WHERE sales_order_id IN (SELECT id FROM sales_orders WHERE business_id = ANY($1::uuid[]))`, [ids]);
    await client.query(`DELETE FROM sales_orders WHERE business_id = ANY($1::uuid[])`, [ids]);
    await client.query(`DELETE FROM credit_notes WHERE business_id = ANY($1::uuid[])`, [ids]);
    await client.query(`DELETE FROM debit_notes WHERE business_id = ANY($1::uuid[])`, [ids]);
    await client.query(`DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE business_id = ANY($1::uuid[]))`, [ids]);
    await client.query(`DELETE FROM invoices WHERE business_id = ANY($1::uuid[])`, [ids]);
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

async function seed() {
  const orphans = await pool.query(`SELECT id FROM businesses WHERE name LIKE 'P3M %'`);
  if (orphans.rows.length) await purge(orphans.rows.map((row) => row.id));
  const plan = await pool.query(
    `SELECT plan_id FROM subscription_plan_features
      WHERE enabled = true AND feature_id IN (
        'sales_estimates','sales_sales_orders','purchase_expenses','settings_multi_warehouse',
        'purchase_management','sales_credit_notes','sales_recurring_invoices','purchase_suppliers'
      )
      GROUP BY plan_id ORDER BY COUNT(DISTINCT feature_id) DESC LIMIT 1`,
  );
  if (!plan.rows[0]) throw new Error('No subscription plan');
  const hash = bcrypt.hashSync(password, 8);
  for (const [id, name, gst] of [
    [A, `P3M A ${tag}`, '27AAAPA1234A1Z5'],
    [B, `P3M B ${tag}`, '29AAAPA1234A1Z5'],
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
    `INSERT INTO customers (id, business_id, name, is_active, current_balance) VALUES ($1, $2, $3, true, 100), ($4, $5, $6, true, 100)`,
    [customerA, A, markA, customerB, B, markB],
  );
  await pool.query(
    `INSERT INTO suppliers (id, business_id, name, is_active, state_code, current_balance)
     VALUES ($1, $2, $3, true, '27', 100), ($4, $5, $6, true, '29', 100)`,
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
    const invoice = randomUUID();
    await q('invoice',
      `INSERT INTO invoices (id, business_id, customer_id, invoice_number, invoice_date, status, document_type,
          place_of_supply_state_code, subtotal, tax_total, grand_total, paid_amount, balance_amount, payment_status, branch_id)
       VALUES ($1, $2, $3, $4, CURRENT_DATE, 'final', 'tax_invoice', '27', $5, 0, $5, 0, $5, 'unpaid', $6)`,
      [invoice, biz, customer, mark, total, branch],
    );
    await q('invoice-line',
      `INSERT INTO invoice_items (invoice_id, item_id, item_name, quantity, unit_price, tax_rate, tax_amount, line_total)
       VALUES ($1, $2, $3, 1, $4, 0, 0, $4)`,
      [invoice, biz === A ? itemA : itemB, mark, total],
    );
    await q('proforma',
      `INSERT INTO invoices (id, business_id, customer_id, invoice_number, invoice_date, status, document_type,
          place_of_supply_state_code, subtotal, tax_total, grand_total, paid_amount, balance_amount, payment_status, branch_id)
       VALUES ($1, $2, $3, $4, CURRENT_DATE, 'draft', 'proforma_invoice', '27', $5, 0, $5, 0, $5, 'unpaid', $6)`,
      [randomUUID(), biz, customer, `${mark}-pf`, total, branch],
    );
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
    await q('credit',
      `INSERT INTO credit_notes (id, business_id, branch_id, customer_id, credit_note_number, credit_note_date, subtotal, grand_total, status, created_by)
       VALUES ($1, $2, $3, $4, $5, CURRENT_DATE, 10, 10, 'active', $6)`,
      [randomUUID(), biz, branch, customer, mark, biz === A ? ownerA : ownerB],
    );
    await q('expense',
      `INSERT INTO expenses (id, business_id, branch_id, amount, description, expense_date, payment_mode, created_by)
       VALUES ($1, $2, $3, 25, $4, CURRENT_DATE, 'cash', $5)`,
      [randomUUID(), biz, branch, mark, biz === A ? ownerA : ownerB],
    );
    await q('debit',
      `INSERT INTO debit_notes (id, business_id, branch_id, customer_id, debit_note_number, debit_note_date, subtotal, grand_total, status, created_by)
       VALUES ($1, $2, $3, $4, $5, CURRENT_DATE, 10, 10, 'active', $6)`,
      [randomUUID(), biz, branch, customer, mark, biz === A ? ownerA : ownerB],
    );
    await q('order',
      `INSERT INTO sales_orders (id, business_id, customer_id, branch_id, order_number, order_date, status, subtotal, grand_total, payment_status)
       VALUES ($1, $2, $3, $4, $5, CURRENT_DATE, 'confirmed', 9, 9, 'unpaid')`,
      [randomUUID(), biz, customer, branch, mark],
    );
    await q('estimate',
      `INSERT INTO estimates (id, business_id, customer_id, estimate_number, estimate_date, status, subtotal, grand_total)
       VALUES ($1, $2, $3, $4, CURRENT_DATE, 'draft', 10, 10)`,
      [randomUUID(), biz, customer, mark],
    );
  }
}

async function counts(businessId) {
  const row = await pool.query(
    `SELECT
       (SELECT COUNT(*) FROM customers WHERE business_id = $1)::text AS customers,
       (SELECT COUNT(*) FROM items WHERE business_id = $1)::text AS items,
       (SELECT COUNT(*) FROM suppliers WHERE business_id = $1)::text AS suppliers,
       (SELECT COUNT(*) FROM estimates WHERE business_id = $1)::text AS estimates,
       (SELECT COUNT(*) FROM sales_orders WHERE business_id = $1)::text AS orders,
       (SELECT COUNT(*) FROM expenses WHERE business_id = $1)::text AS expenses,
       (SELECT COUNT(*) FROM purchase_orders WHERE business_id = $1)::text AS purchase_orders,
       (SELECT COUNT(*) FROM inventory_adjustments WHERE business_id = $1)::text AS adjustments,
       (SELECT COUNT(*) FROM stock_transfers WHERE business_id = $1)::text AS transfers,
       (SELECT COUNT(*) FROM purchase_returns WHERE business_id = $1)::text AS returns,
       (SELECT COUNT(*) FROM recurring_invoices WHERE business_id = $1)::text AS recurring,
       (SELECT COUNT(*) FROM stock_movements WHERE business_id = $1)::text AS stock,
       (SELECT COUNT(*) FROM ledger_entry_lines WHERE business_id = $1)::text AS ledger,
       (SELECT COALESCE(SUM(current_balance), 0)::text FROM suppliers WHERE business_id = $1) AS supplier_balance`,
    [businessId],
  );
  return row.rows[0];
}

function startServer() {
  server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '-p', String(PORT)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      DB_NAME: 'kh_phase2_test',
      DB_PORT: port,
      DB_SSL: 'false',
      E2E_DISABLE_RATE_LIMIT: 'true',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  const onData = (chunk) => {
    log += chunk.toString();
    if (log.length > 8000) log = log.slice(-8000);
  };
  server.stdout.on('data', onData);
  server.stderr.on('data', onData);
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
          // server still starting
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
    };
    wait();
  });
}

function stopServer() {
  if (!server || server.killed) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/PID', String(server.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    server.kill('SIGTERM');
  }
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
  const text = await res.text();
  return { status: res.status, cookie: cookieFrom(res), error: text.includes('error') ? 'login rejected' : '' };
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
  });
  return { status: res.status, text: await res.text() };
}

const spoof = {
  'x-authenticated-user-id': ownerB,
  'x-authenticated-business-id': B,
  'x-authenticated-session-version': '1',
};

const gets = [
  ['/api/invoices', {}],
  ['/api/items', {}],
  ['/api/purchases', {}],
  ['/api/payments', {}],
  ['/api/dashboard/today-sales', {}],
  ['/api/dashboard/recent-invoices', { limit: 5 }],
  ['/api/dashboard/top-customers', { limit: 10 }],
  ['/api/dashboard/today-purchases', {}],
  ['/api/dashboard/sales-summary', {}],
  ['/api/dashboard/charts', { start_date: '2026-10-01', end_date: '2026-10-31' }],
  ['/api/dashboard/low-stock', { limit: 5 }],
  ['/api/dashboard/top-products', {}],
  ['/api/dashboard/receivables', {}],
  ['/api/dashboard/cash-flow', { fiscal_year: '2026' }],
  ['/api/credit-notes', {}],
  ['/api/expenses', {}],
  ['/api/debit-notes', {}],
  ['/api/estimates', {}],
  ['/api/sales-orders', {}],
  ['/api/customers', {}],
];

function codeOf(text) {
  try {
    const body = JSON.parse(text);
    return body.code || body.error || '';
  } catch {
    return '';
  }
}

async function main() {
  await assertDb();
  await seed();
  await startServer();
  console.log(`next dev listening on 127.0.0.1:${PORT}`);
  const sessionA = await login(phoneA);
  const sessionB = await login(phoneB);
  record('POST /api/auth/login', 'user that exists only in kh_phase2_test', sessionA.status === 200 && sessionA.cookie.includes('khatario_session') && sessionB.status === 200, `A ${sessionA.status} B ${sessionB.status}`);
  if (sessionA.status !== 200 || sessionB.status !== 200) throw new Error('login failed');

  for (const [route, query] of gets) {
    const anon = await http('GET', route, { query: { ...query, business_id: B, user_id: ownerB }, headers: spoof });
    record(`GET ${route}`, 'no session with forged identity', anon.status === 401 && !anon.text.includes(markA) && !anon.text.includes(markB), `HTTP ${anon.status}`);
    const clean = await http('GET', route, { cookie: sessionA.cookie, query });
    const forged = await http('GET', route, { cookie: sessionA.cookie, query: { ...query, business_id: B, user_id: ownerB }, headers: spoof });
    const ownB = await http('GET', route, { cookie: sessionB.cookie, query });
    const isolated = forged.status === 200 && forged.text === clean.text && !forged.text.includes(markB) && clean.status === 200;
    const bHasMarker = ownB.text.includes(markB);
    record(`GET ${route}`, 'session A ignores business B', isolated && ownB.status === 200 && (bHasMarker || ownB.text !== clean.text), `A ${clean.status} forged ${forged.status} B ${ownB.status} markerB ${bHasMarker}`);
  }

  const beforeB = await counts(B);
  const writes = [
    ['POST', '/api/customers', { name: `forged-${tag}-c`, business_id: B, user_id: ownerB, created_by: ownerB }],
    ['POST', '/api/items', { name: `forged-${tag}-i`, business_id: B, user_id: ownerB, created_by: ownerB, selling_price: 10 }],
    ['POST', '/api/suppliers', { name: `forged-${tag}-s`, business_id: B, user_id: ownerB, created_by: ownerB }],
    ['POST', '/api/estimates', { business_id: B, customer_id: customerB, estimate_number: `${markB}-e`, estimate_date: day, items: [{ description: markB, qty: 1, unit_price: 10, line_total: 10 }], subtotal: 10, grand_total: 10 }],
    ['POST', '/api/sales-orders', { business_id: B, branch_id: branchB, customer_id: customerB, order_number: `${markB}-so`, order_date: day, items: [{ item_id: itemB, item_name: markB, qty: 1, unit_price: 9 }] }],
    ['POST', '/api/expenses', { business_id: B, branch_id: branchB, amount: 12, expense_date: day, payment_mode: 'cash', description: markB, created_by: ownerB }],
    ['POST', '/api/purchase-orders', { business_id: B, supplier_id: supplierB, order_number: `${markB}-po`, order_date: day, items: [{ item_name: markB, qty: 1, unit_price: 5 }], created_by: ownerB }],
    ['POST', '/api/inventory-adjustments', { business_id: B, item_id: itemB, branch_id: branchB, adjustment_type: 'QUANTITY', direction: 'INCREASE', quantity: 1, reason_code: 'STOCK_TAKE', adjustment_date: day, created_by: ownerB }],
    ['POST', '/api/stock-transfers', { business_id: B, transfer_number: `${markB}-st`, transfer_date: day, from_location_id: whB1, to_location_id: whB2, items: [{ item_id: itemB, qty: 1, unit: 'PCS' }], created_by: ownerB }],
    ['POST', '/api/purchase-returns', { business_id: B, supplier_id: supplierB, return_number: `${markB}-pr`, return_date: day, items: [{ item_id: itemB, description: markB, qty: 1, unit_price: 10, tax_rate: 0 }], created_by: ownerB }],
    ['POST', '/api/recurring-invoices', { business_id: B, customer_id: customerB, frequency: 'monthly', start_date: day, items: [{ item_id: itemB, name: markB, quantity: 1, unit_price: 10 }] }],
  ];
  for (const [method, route, body] of writes) {
    const anon = await http(method, route, { body, headers: spoof });
    const after = await counts(B);
    record(`${method} ${route}`, 'no session', anon.status === 401 && JSON.stringify(after) === JSON.stringify(beforeB), `HTTP ${anon.status} ${codeOf(anon.text)}`);
  }
  const customerBefore = await pool.query(`SELECT name FROM customers WHERE id = $1`, [customerB]);
  const putAnon = await http('PUT', `/api/customers/${customerB}`, { body: { name: `${markB}-hacked`, business_id: B, user_id: ownerB }, headers: spoof });
  const customerAfter = await pool.query(`SELECT name FROM customers WHERE id = $1`, [customerB]);
  record('PUT /api/customers/[id]', 'no session', putAnon.status === 401 && customerAfter.rows[0].name === customerBefore.rows[0].name, `HTTP ${putAnon.status}`);

  for (const [method, route, body] of writes) {
    const before = await counts(B);
    const res = await http(method, route, { cookie: sessionA.cookie, body, headers: spoof });
    const after = await counts(B);
    const bSame = JSON.stringify(before) === JSON.stringify(after);
    let landedOnA = false;
    if (typeof body.name === 'string' && body.name.startsWith('forged-')) {
      const table = route.endsWith('/items') ? 'items' : route.endsWith('/suppliers') ? 'suppliers' : 'customers';
      const where = await pool.query(`SELECT business_id FROM ${table} WHERE name = $1`, [body.name]);
      landedOnA = where.rows.length === 1 && where.rows[0].business_id === A;
    }
    const rejected = res.status >= 400 && res.status < 500 && bSame;
    const ignoredForgery = res.status === 201 && bSame && landedOnA && !res.text.includes(markB) && !res.text.includes(B);
    record(`${method} ${route}`, 'session A body names B', rejected || ignoredForgery, `HTTP ${res.status} ${String(codeOf(res.text)).slice(0, 60)} bUnchanged ${bSame}`);
  }
  const putForged = await http('PUT', `/api/customers/${customerB}`, {
    cookie: sessionA.cookie,
    body: { name: `${markB}-hacked`, business_id: B, user_id: ownerA },
    headers: spoof,
  });
  const nameNow = await pool.query(`SELECT name FROM customers WHERE id = $1`, [customerB]);
  record('PUT /api/customers/[id]', 'session A updates B', putForged.status !== 200 && nameNow.rows[0].name === markB, `HTTP ${putForged.status}`);

  const own = [
    ['POST', '/api/customers', { name: `${markA}-new` }],
    ['POST', '/api/items', { name: `${markA}-new`, selling_price: 10 }],
    ['POST', '/api/suppliers', { name: `${markA}-new` }],
    ['POST', '/api/estimates', { customer_id: customerA, estimate_number: `${markA}-e2`, estimate_date: day, items: [{ description: markA, qty: 1, unit_price: 10, line_total: 10 }], subtotal: 10, grand_total: 10 }],
    ['POST', '/api/sales-orders', { branch_id: branchA, customer_id: customerA, order_number: `${markA}-so2`, order_date: day, items: [{ item_id: itemA, item_name: markA, qty: 1, unit_price: 9 }] }],
    ['POST', '/api/expenses', { branch_id: branchA, amount: 12, expense_date: day, payment_mode: 'cash', description: `${markA}-exp` }],
    ['POST', '/api/purchase-orders', { supplier_id: supplierA, order_number: `${markA}-po`, order_date: day, items: [{ item_name: markA, qty: 1, unit_price: 5 }] }],
    ['POST', '/api/inventory-adjustments', { item_id: itemA, branch_id: branchA, adjustment_type: 'QUANTITY', direction: 'INCREASE', quantity: 1, reason_code: 'STOCK_TAKE', adjustment_date: day }],
    ['POST', '/api/stock-transfers', { transfer_number: `${markA}-st`, transfer_date: day, from_location_id: whA1, to_location_id: whA2, items: [{ item_id: itemA, qty: 1, unit: 'PCS' }] }],
    ['POST', '/api/purchase-returns', { supplier_id: supplierA, return_number: `${markA}-pr`, return_date: day, items: [{ item_id: itemA, description: markA, qty: 1, unit_price: 10, tax_rate: 0 }] }],
    ['POST', '/api/recurring-invoices', { customer_id: customerA, frequency: 'monthly', start_date: day, items: [{ item_id: itemA, name: markA, quantity: 1, unit_price: 10 }] }],
  ];
  const beforeOwnB = await counts(B);
  for (const [method, route, body] of own) {
    const beforeA = await counts(A);
    const res = await http(method, route, { cookie: sessionA.cookie, body });
    const afterA = await counts(A);
    record(`${method} ${route}`, 'session A own records', res.status === 201 && JSON.stringify(await counts(B)) === JSON.stringify(beforeOwnB) && JSON.stringify(afterA) !== JSON.stringify(beforeA), `HTTP ${res.status} ${String(codeOf(res.text)).slice(0, 80)}`);
  }
  const renamed = await http('PUT', `/api/customers/${customerA}`, { cookie: sessionA.cookie, body: { name: `${markA}-renamed` } });
  const renamedRow = await pool.query(`SELECT name, business_id FROM customers WHERE id = $1`, [customerA]);
  record('PUT /api/customers/[id]', 'session A own customer', renamed.status === 200 && renamedRow.rows[0].name === `${markA}-renamed` && renamedRow.rows[0].business_id === A, `HTTP ${renamed.status}`);

  await pool.query(`UPDATE users SET auth_session_version = 2 WHERE id = $1`, [ownerA]);
  const beforeStale = await counts(B);
  for (const [route, query] of gets) {
    const staleGet = await http('GET', route, { cookie: sessionA.cookie, query: { ...query, business_id: B }, headers: spoof });
    record(`GET ${route}`, 'stale session', staleGet.status === 401 && !staleGet.text.includes(markA) && !staleGet.text.includes(markB), `HTTP ${staleGet.status}`);
  }
  for (const [method, route, body] of writes) {
    const stalePost = await http(method, route, { cookie: sessionA.cookie, body, headers: spoof });
    record(`${method} ${route}`, 'stale session', stalePost.status === 401 && !stalePost.text.includes(markB), `HTTP ${stalePost.status}`);
  }
  const putStale = await http('PUT', `/api/customers/${customerB}`, { cookie: sessionA.cookie, body: { name: `${markB}-stale`, business_id: B }, headers: spoof });
  const staleName = await pool.query(`SELECT name FROM customers WHERE id = $1`, [customerB]);
  const staleCounts = await counts(B);
  record('PUT /api/customers/[id]', 'stale session', putStale.status === 401 && staleName.rows[0].name === markB && JSON.stringify(staleCounts) === JSON.stringify(beforeStale), `HTTP ${putStale.status}`);

  const failed = results.filter((row) => !row.ok);
  console.log(`SUMMARY pass=${results.length - failed.length} fail=${failed.length}`);
  if (failed.length) process.exitCode = 1;
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
