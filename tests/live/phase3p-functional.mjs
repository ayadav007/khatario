/**
 * Phase 3P functional follow-up. Live HTTP only. Does not change application code.
 * Does not print cookies, passwords, or the database URL.
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
const PORT = 3112;
const BASE = `http://127.0.0.1:${PORT}`;
const day = new Date(Date.now() + 330 * 60 * 1000).toISOString().slice(0, 10);

const A = randomUUID();
const B = randomUUID();
const branchA = randomUUID();
const branchB = randomUUID();
const ownerA = randomUUID();
const ownerB = randomUUID();
const customerA = randomUUID();
const supplierA = randomUUID();
const supplierB = randomUUID();
const itemA = randomUUID();
const itemB = randomUUID();
const whA1 = randomUUID();
const whA2 = randomUUID();
const transferA = randomUUID();
const tag = A.slice(0, 8);
const mark = `P3PF-${tag}`;
const password = `Qa${randomBytes(9).toString('hex')}!`;
const phoneA = `91${Date.now().toString().slice(-8)}1`;
const phoneB = `91${Date.now().toString().slice(-8)}2`;
let debitA;
let creditA;

const pool = new pg.Pool({ connectionString: databaseUrl });
const results = [];
let server;

function record(level, scenario, detail) {
  results.push({ level, scenario, detail });
  console.log(`${level} ${scenario} ${detail}`);
}

function brief(text) {
  try {
    const body = JSON.parse(text);
    return String(body.code || body.error || '').replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, 'id').slice(0, 90);
  } catch {
    return '';
  }
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
    await client.query(`DELETE FROM ledger_entry_reversals WHERE original_line_id IN (SELECT id FROM ledger_entry_lines WHERE business_id = ANY($1::uuid[])) OR reversal_line_id IN (SELECT id FROM ledger_entry_lines WHERE business_id = ANY($1::uuid[]))`, [ids]);
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
    await client.query(`DELETE FROM purchases WHERE business_id = ANY($1::uuid[])`, [ids]);
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
  const orphans = await pool.query(`SELECT id FROM businesses WHERE name LIKE 'P3PF %'`);
  if (orphans.rows.length) await purge(orphans.rows.map((row) => row.id));
  const plan = await pool.query(
    `SELECT plan_id FROM subscription_plan_features
      WHERE enabled = true AND feature_id IN ('purchase_management','sales_recurring_invoices','settings_multi_warehouse','advanced_ledger')
      GROUP BY plan_id ORDER BY COUNT(DISTINCT feature_id) DESC LIMIT 1`,
  );
  if (!plan.rows[0]) throw new Error('No subscription plan');
  const hash = bcrypt.hashSync(password, 8);
  await pool.query(
    `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type, primary_module)
     VALUES ($1, $2, $3, '27', 'regular', 'billing'), ($4, $5, $6, '29', 'regular', 'billing')`,
    [A, `P3PF A ${tag}`, `27AAP3PF${tag.slice(0, 4)}1Z5`, B, `P3PF B ${tag}`, `29AAP3PF${tag.slice(0, 4)}1Z6`],
  );
  for (const id of [A, B]) {
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
    `INSERT INTO branches (id, business_id, name, state_code, is_default, is_active) VALUES ($1, $2, 'Main', '27', true, true), ($3, $4, 'Main', '29', true, true)`,
    [branchA, A, branchB, B],
  );
  await pool.query(
    `INSERT INTO users (id, business_id, name, phone, password_hash, is_primary_admin, auth_session_version, is_active)
     VALUES ($1, $2, 'Owner A', $3, $4, true, 1, true), ($5, $6, 'Owner B', $7, $4, true, 1, true)`,
    [ownerA, A, phoneA, hash, ownerB, B, phoneB],
  );
  await pool.query(
    `INSERT INTO user_branches (user_id, branch_id, can_view, can_edit, can_delete, can_create_transactions)
     VALUES ($1, $2, true, true, true, true), ($3, $4, true, true, true, true)`,
    [ownerA, branchA, ownerB, branchB],
  );
  await pool.query(`INSERT INTO customers (id, business_id, name, is_active, state_code) VALUES ($1, $2, $3, true, '27')`, [customerA, A, mark]);
  await pool.query(
    `INSERT INTO suppliers (id, business_id, name, is_active, state_code, current_balance)
     VALUES ($1, $2, $3, true, '27', 40), ($4, $5, $6, true, '29', 70)`,
    [supplierA, A, mark, supplierB, B, `${mark}-b`],
  );
  await pool.query(
    `INSERT INTO items (id, business_id, name, item_type, unit, selling_price, purchase_price, tax_rate, hsn_sac)
     VALUES ($1, $2, $3, 'goods', 'PCS', 25, 15, 0, '847130'), ($4, $5, $6, 'goods', 'PCS', 10, 8, 0, '847130')`,
    [itemA, A, mark, itemB, B, `${mark}-b`],
  );
  await pool.query(
    `INSERT INTO warehouses (id, business_id, branch_id, name, is_active) VALUES ($1, $2, $3, 'A1', true), ($4, $2, $3, 'A2', true)`,
    [whA1, A, branchA, whA2],
  );
  await pool.query(`INSERT INTO branch_warehouses (branch_id, warehouse_id, is_primary) VALUES ($1, $2, true), ($1, $3, false)`, [branchA, whA1, whA2]);
  await pool.query(`INSERT INTO location_stock (location_id, item_id, current_stock_qty) VALUES ($1, $2, 8), ($3, $2, 5)`, [whA1, itemA, whA2]);
  await pool.query(
    `INSERT INTO purchases (id, business_id, supplier_id, bill_number, bill_date, status, place_of_supply_state_code, subtotal, tax_total, grand_total, paid_amount, branch_id)
     VALUES ($1, $2, $3, $4, CURRENT_DATE, 'final', '27', 12, 0, 12, 0, $5)`,
    [randomUUID(), A, supplierA, `${mark}-bill`, branchA],
  );
  await pool.query(
    `INSERT INTO payments (id, business_id, branch_id, type, customer_id, amount, payment_mode, payment_date, status)
     VALUES ($1, $2, $3, 'receivable', $4, 12, 'cash', CURRENT_DATE, 'active')`,
    [randomUUID(), A, branchA, customerA],
  );
  await pool.query(
    `INSERT INTO stock_transfers (id, business_id, transfer_number, transfer_date, from_location_id, to_location_id, status, notes, created_by)
     VALUES ($1, $2, $3, CURRENT_DATE, $4, $5, 'pending', $6, $7)`,
    [transferA, A, `${mark}-move`, whA2, whA1, `${mark}-move-note`, ownerA],
  );
  await pool.query(
    `INSERT INTO stock_transfer_items (id, transfer_id, item_id, qty, quantity_requested, unit) VALUES ($1, $2, $3, 1, 1, 'PCS')`,
    [randomUUID(), transferA, itemA],
  );
  const accounts = await pool.query(
    `SELECT
       (SELECT id FROM accounts WHERE business_id = $1 AND nature = 'debit' ORDER BY account_code LIMIT 1) AS debit_id,
       (SELECT id FROM accounts WHERE business_id = $1 AND nature = 'credit' ORDER BY account_code LIMIT 1) AS credit_id`,
    [A],
  );
  debitA = accounts.rows[0].debit_id;
  creditA = accounts.rows[0].credit_id;
  if (!debitA || !creditA) throw new Error('chart of accounts missing');
}

function startServer() {
  server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '-p', String(PORT)], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: databaseUrl, DB_NAME: 'kh_phase2_test', DB_PORT: dbPort, DB_SSL: 'false', E2E_DISABLE_RATE_LIMIT: 'true', NODE_OPTIONS: '--max-old-space-size=8192' },
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

async function http(method, route, { cookie, body, query } = {}) {
  const url = new URL(route, BASE);
  for (const [key, value] of Object.entries(query || {})) url.searchParams.set(key, String(value));
  const res = await fetch(url, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    redirect: 'manual',
    signal: AbortSignal.timeout(90000),
  });
  return { status: res.status, text: await res.text() };
}

async function money(sql, params) {
  const row = await pool.query(sql, params);
  return row.rows[0] || {};
}

async function main() {
  await assertDb();
  await seed();
  await startServer();
  console.log(`next dev listening on 127.0.0.1:${PORT}`);
  const session = await login(phoneA);
  record(session.status === 200 && session.cookie.includes('khatario_session') ? 'PASS' : 'FAIL', 'login', `HTTP ${session.status}`);
  if (session.status !== 200) throw new Error('login failed');
  const cookie = session.cookie;

  const journal = await http('POST', '/api/journal-entries', {
    cookie,
    body: { entry_date: day, narration: `${mark}-journal`, lines: [{ account_id: debitA, debit: 6, credit: 0 }, { account_id: creditA, debit: 0, credit: 6 }] },
  });
  const lists = [
    ['/api/journal-entries', `${mark}-journal`],
    ['/api/purchases', `${mark}-bill`],
    ['/api/payments', mark],
  ];
  for (const [route, marker] of lists) {
    const list = await http('GET', route, { cookie });
    record(journal.status === 201 && list.status === 200 && list.text.includes(marker) ? 'PASS' : 'FAIL', `GET ${route}`, `HTTP ${list.status}`);
  }

  const poBody = {
    supplier_id: supplierA,
    order_number: `${mark}-po`,
    order_date: day,
    status: 'draft',
    subtotal: 100,
    tax_total: 18,
    grand_total: 118,
    items: [{ item_id: itemA, item_name: mark, qty: 2, unit: 'PCS', unit_price: 50, tax_rate: 18, tax_amount: 18, taxable_value: 100, line_total: 118 }],
  };
  const po = await http('POST', '/api/purchase-orders', { cookie, body: poBody });
  const stored = await money(
    `SELECT po.status, po.subtotal::text, po.tax_total::text, po.grand_total::text, poi.qty::text, poi.unit_price::text, poi.line_total::text, poi.item_name
       FROM purchase_orders po JOIN purchase_order_items poi ON poi.purchase_order_id = po.id
      WHERE po.order_number = $1 AND po.business_id = $2`,
    [`${mark}-po`, A],
  );
  const poOk = po.status === 201 && stored.status === 'draft' && stored.subtotal === '100.00' && stored.tax_total === '18.00' && stored.grand_total === '118.00' && stored.qty === '2.00' && stored.unit_price === '50.00' && stored.line_total === '118.00' && stored.item_name === mark;
  record(poOk ? 'PASS' : 'FAIL', 'POST purchase order stored totals', `HTTP ${po.status} ${brief(po.text)} subtotal ${stored.subtotal} tax ${stored.tax_total} grand ${stored.grand_total} qty ${stored.qty} price ${stored.unit_price} line ${stored.line_total}`);
  const draft = await http('GET', '/api/purchase-orders', { cookie, query: { status: 'draft' } });
  const confirmed = await http('GET', '/api/purchase-orders', { cookie, query: { status: 'confirmed' } });
  record(draft.status === 200 && draft.text.includes(`${mark}-po`) && confirmed.status === 200 && !confirmed.text.includes(`${mark}-po`) ? 'PASS' : 'FAIL', 'purchase order status filter', `draft ${draft.status} confirmed ${confirmed.status}`);
  record('NOT TESTED', 'purchase order search and pagination', 'GET reads status only');

  const beforeLedger = await money(`SELECT COUNT(*)::int AS n FROM ledger_entry_lines WHERE business_id = $1`, [A]);
  const beforeSupplierB = await money(`SELECT current_balance::text AS bal FROM suppliers WHERE id = $1`, [supplierB]);
  const rejected = await http('POST', '/api/purchase-returns', {
    cookie,
    body: { supplier_id: supplierB, return_number: `${mark}-bad`, return_date: day, items: [{ item_id: itemA, description: mark, qty: 1, unit_price: 15, tax_rate: 0 }] },
  });
  const afterRejectLedger = await money(`SELECT COUNT(*)::int AS n FROM ledger_entry_lines WHERE business_id = $1`, [A]);
  const afterSupplierB = await money(`SELECT current_balance::text AS bal FROM suppliers WHERE id = $1`, [supplierB]);
  const rejectRows = await money(`SELECT COUNT(*)::int AS n FROM purchase_returns WHERE return_number = $1`, [`${mark}-bad`]);
  record(rejected.status === 400 && rejectRows.n === 0 && afterRejectLedger.n === beforeLedger.n && afterSupplierB.bal === beforeSupplierB.bal ? 'PASS' : 'FAIL', 'rejected purchase return leaves no row or ledger', `HTTP ${rejected.status} ${brief(rejected.text)}`);

  const stockBefore = await pool.query(`SELECT location_id, current_stock_qty::float8 AS qty FROM location_stock WHERE item_id = $1`, [itemA]);
  const branchBefore = await money(`SELECT COALESCE(quantity, 0)::float8 AS qty FROM branch_item_stock WHERE business_id = $1 AND branch_id = $2 AND item_id = $3`, [A, branchA, itemA]);
  const created = await http('POST', '/api/purchase-returns', {
    cookie,
    body: { supplier_id: supplierA, return_number: `${mark}-ret`, return_date: day, items: [{ item_id: itemA, description: mark, qty: 2, unit_price: 15, tax_rate: 0 }] },
  });
  const ret = await money(
    `SELECT id, grand_total::text, subtotal::text, tax_total::text, status FROM purchase_returns WHERE return_number = $1 AND business_id = $2`,
    [`${mark}-ret`, A],
  );
  const line = await money(`SELECT qty::text, unit_price::text, line_total::text FROM purchase_return_items WHERE return_id = $1`, [ret.id]);
  const supplier = await money(`SELECT current_balance::text AS bal FROM suppliers WHERE id = $1`, [supplierA]);
  const movement = await money(`SELECT type, quantity::float8 AS quantity, location_id FROM stock_movements WHERE business_id = $1 AND reference_type = 'purchase_return' AND reference_id = $2`, [A, ret.id]);
  const movedStock = movement.location_id
    ? await money(`SELECT current_stock_qty::float8 AS qty FROM location_stock WHERE location_id = $1 AND item_id = $2`, [movement.location_id, itemA])
    : await money(`SELECT quantity::float8 AS qty FROM branch_item_stock WHERE business_id = $1 AND branch_id = $2 AND item_id = $3`, [A, branchA, itemA]);
  const beforeQty = movement.location_id
    ? Number(stockBefore.rows.find((row) => row.location_id === movement.location_id)?.qty || 0)
    : Number(branchBefore.qty || 0);
  const ledger = await money(
    `SELECT COALESCE(SUM(debit), 0)::float8 AS debit, COALESCE(SUM(credit), 0)::float8 AS credit, COUNT(*)::int AS n
       FROM ledger_entry_lines WHERE business_id = $1 AND voucher_type = 'purchase_return' AND voucher_id = $2`,
    [A, ret.id],
  );
  const returnOk = created.status === 201 && ret.grand_total === '30.00' && ret.subtotal === '30.00' && ret.tax_total === '0.00' && Number(line.qty) === 2 && Number(line.unit_price) === 15 && Number(line.line_total) === 30 && supplier.bal === '10.00' && Number(movedStock.qty) === beforeQty - 2 && movement.type === 'out' && Number(movement.quantity) === 2 && Number(ledger.debit) === Number(ledger.credit) && Number(ledger.debit) === 60 && ledger.n === 4;
  record(returnOk ? 'PASS' : 'FAIL', 'purchase return stock supplier and ledger', `HTTP ${created.status} ${brief(created.text)} grand ${ret.grand_total} supplier ${supplier.bal} stock ${beforeQty}->${movedStock.qty} move ${movement.type} ${movement.quantity} ledger ${ledger.debit}/${ledger.credit} lines ${ledger.n}`);

  const searched = await http('GET', '/api/purchase-returns', { cookie, query: { search: `${mark}-ret` } });
  const page = await http('GET', '/api/purchase-returns', { cookie, query: { page: '1', limit: '1' } });
  let pageBody = {};
  try { pageBody = JSON.parse(page.text); } catch { pageBody = {}; }
  record(searched.status === 200 && searched.text.includes(`${mark}-ret`) ? 'PASS' : 'FAIL', 'purchase return search', `HTTP ${searched.status}`);
  record(page.status === 200 && Array.isArray(pageBody.purchaseReturns) && pageBody.purchaseReturns.length === 1 && Number(pageBody.pagination?.total) >= 1 ? 'PASS' : 'FAIL', 'purchase return page limit', `HTTP ${page.status} rows ${pageBody.purchaseReturns?.length} total ${pageBody.pagination?.total}`);

  const cancel = await http('POST', `/api/purchase-returns/${ret.id}/cancel`, { cookie, body: { reason: 'counted twice' } });
  const cancelled = await money(`SELECT status FROM purchase_returns WHERE id = $1`, [ret.id]);
  const supplierAfter = await money(`SELECT current_balance::text AS bal FROM suppliers WHERE id = $1`, [supplierA]);
  const stockAfter = movement.location_id
    ? await money(`SELECT current_stock_qty::float8 AS qty FROM location_stock WHERE location_id = $1 AND item_id = $2`, [movement.location_id, itemA])
    : await money(`SELECT quantity::float8 AS qty FROM branch_item_stock WHERE business_id = $1 AND branch_id = $2 AND item_id = $3`, [A, branchA, itemA]);
  const cancelMove = await money(`SELECT type, quantity::float8 AS quantity FROM stock_movements WHERE business_id = $1 AND reference_type = 'purchase_return_cancel' AND reference_id = $2`, [A, ret.id]);
  const net = await money(
    `SELECT COALESCE(SUM(debit), 0)::float8 AS debit, COALESCE(SUM(credit), 0)::float8 AS credit,
            COUNT(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM ledger_entry_reversals r WHERE r.original_line_id = ledger_entry_lines.id OR r.reversal_line_id = ledger_entry_lines.id))::int AS active
       FROM ledger_entry_lines WHERE business_id = $1 AND voucher_type = 'purchase_return' AND voucher_id = $2`,
    [A, ret.id],
  );
  const cancelOk = cancel.status === 200 && cancelled.status === 'cancelled' && supplierAfter.bal === '40.00' && Number(stockAfter.qty) === beforeQty && cancelMove.type === 'in' && Number(cancelMove.quantity) === 2 && Number(net.debit) === Number(net.credit) && net.active === 0;
  record(cancelOk ? 'PASS' : 'FAIL', 'purchase return cancel restores stock supplier and ledger', `HTTP ${cancel.status} ${brief(cancel.text)} supplier ${supplierAfter.bal} stock ${stockAfter.qty} move ${cancelMove.type} ${cancelMove.quantity} ledger ${net.debit}/${net.credit} active ${net.active}`);

  const srcBefore = await money(`SELECT current_stock_qty::text AS qty FROM location_stock WHERE location_id = $1 AND item_id = $2`, [whA2, itemA]);
  const dispatch = await http('PATCH', `/api/stock-transfers/${transferA}/dispatch`, { cookie, body: {} });
  const srcAfter = await money(`SELECT current_stock_qty::text AS qty FROM location_stock WHERE location_id = $1 AND item_id = $2`, [whA2, itemA]);
  const statusMid = await money(`SELECT status FROM stock_transfers WHERE id = $1`, [transferA]);
  const outMove = await money(`SELECT quantity::float8 AS quantity FROM stock_movements WHERE business_id = $1 AND reference_id = $2 AND type = 'out' AND reference_type = 'stock_transfer'`, [A, transferA]);
  record(dispatch.status === 200 && statusMid.status === 'in_transit' && Number(srcBefore.qty) === 5 && Number(srcAfter.qty) === 4 && Number(outMove.quantity) === 1 ? 'PASS' : 'FAIL', 'stock transfer dispatch', `HTTP ${dispatch.status} ${brief(dispatch.text)} ${srcBefore.qty}->${srcAfter.qty} status ${statusMid.status} qty ${outMove.quantity}`);
  const destBefore = await money(`SELECT COALESCE(current_stock_qty, 0)::text AS qty FROM location_stock WHERE location_id = $1 AND item_id = $2`, [whA1, itemA]);
  const receive = await http('POST', `/api/stock-transfers/${transferA}/receive`, { cookie, body: { received_items: [{ item_id: itemA, received_qty: 1 }] } });
  const destAfter = await money(`SELECT current_stock_qty::text AS qty FROM location_stock WHERE location_id = $1 AND item_id = $2`, [whA1, itemA]);
  const statusEnd = await money(`SELECT status FROM stock_transfers WHERE id = $1`, [transferA]);
  const inMove = await money(`SELECT quantity::float8 AS quantity FROM stock_movements WHERE business_id = $1 AND reference_id = $2 AND type = 'in' AND reference_type = 'stock_transfer'`, [A, transferA]);
  record(receive.status === 200 && statusEnd.status === 'completed' && Number(destAfter.qty) - Number(destBefore.qty) === 1 && Number(inMove.quantity) === 1 ? 'PASS' : 'FAIL', 'stock transfer receipt', `HTTP ${receive.status} ${brief(receive.text)} dest ${destBefore.qty}->${destAfter.qty} status ${statusEnd.status} qty ${inMove.quantity}`);

  const rec = await http('POST', '/api/recurring-invoices', {
    cookie,
    body: { customer_id: customerA, branch_id: branchA, frequency: 'monthly', start_date: day, items: [{ item_id: itemA, item_name: mark, hsn_sac: '847130', unit: 'PCS', quantity: 1, unit_price: 25, tax_rate: 0 }] },
  });
  let recId = null;
  try { recId = JSON.parse(rec.text).recurringInvoice?.id || null; } catch { recId = null; }
  const run = recId ? await http('POST', `/api/recurring-invoices/${recId}`, { cookie, body: { action: 'run_now' } }) : { status: 0, text: '' };
  let createdInvoice = [];
  try { createdInvoice = JSON.parse(run.text).created || []; } catch { createdInvoice = []; }
  const invoice = createdInvoice[0]?.invoice_id
    ? await money(`SELECT to_char(invoice_date, 'YYYY-MM-DD') AS invoice_date, grand_total::text, business_id FROM invoices WHERE id = $1`, [createdInvoice[0].invoice_id])
    : {};
  const schedule = recId
    ? await money(`SELECT to_char(next_run_date, 'YYYY-MM-DD') AS next_run, to_char(last_run_date, 'YYYY-MM-DD') AS last_run FROM recurring_invoices WHERE id = $1`, [recId])
    : {};
  const recOk = rec.status === 201 && run.status === 200 && createdInvoice.length === 1 && createdInvoice[0].run_date === day && invoice.invoice_date === day && invoice.grand_total === '25.00' && invoice.business_id === A && schedule.last_run === day;
  record(recOk ? 'PASS' : 'FAIL', 'recurring run_now invoice date and total', `HTTP ${run.status} ${brief(run.text)} response ${createdInvoice[0]?.run_date || ''} stored ${invoice.invoice_date || ''} total ${invoice.grand_total || ''} next ${schedule.next_run || ''}`);

  const failed = results.filter((row) => row.level === 'FAIL').length;
  const passed = results.filter((row) => row.level === 'PASS').length;
  const untested = results.filter((row) => row.level === 'NOT TESTED').length;
  console.log(`SUMMARY pass=${passed} fail=${failed} not_tested=${untested}`);
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
      const left = await pool.query(`SELECT COUNT(*)::int AS n FROM businesses WHERE name LIKE 'P3PF %'`);
      console.log(`leftover P3PF businesses ${left.rows[0].n}`);
    } catch (error) {
      console.error(`cleanup failed ${error instanceof Error ? error.message : 'purge'}`);
    }
    await pool.end();
  });
