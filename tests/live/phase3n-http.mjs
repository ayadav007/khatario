/**
 * Phase 3N live HTTP check. Does not change the Phase 3M script.
 * Starts Next.js against kh_phase2_test only.
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
const port = envFile.DB_PORT || '5432';
const databaseUrl = `postgresql://${encodeURIComponent(envFile.DB_USER)}:${encodeURIComponent(envFile.DB_PASSWORD)}@${host}:${port}/kh_phase2_test`;
const PORT = 3109;
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
const markA = `P3NA-${tag}`;
const markB = `P3NB-${tag}`;
const password = `Qa${randomBytes(9).toString('hex')}!`;
const phoneA = `91${Date.now().toString().slice(-8)}3`;
const phoneB = `91${Date.now().toString().slice(-8)}4`;
let debitA = null;
let creditA = null;
let debitB = null;
let creditB = null;

const pool = new pg.Pool({ connectionString: databaseUrl });
const results = [];
let server;

function brief(text) {
  try {
    const body = JSON.parse(text);
    return String(body.code || body.error || '').replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, 'id').slice(0, 70);
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
  const orphans = await pool.query(`SELECT id FROM businesses WHERE name LIKE 'P3N %'`);
  if (orphans.rows.length) await purge(orphans.rows.map((row) => row.id));
  const plan = await pool.query(
    `SELECT plan_id FROM subscription_plan_features
      WHERE enabled = true AND feature_id IN (
        'settings_multi_warehouse','purchase_management','purchase_inventory_adjustments',
        'sales_recurring_invoices','purchase_suppliers','advanced_ledger'
      )
      GROUP BY plan_id ORDER BY COUNT(DISTINCT feature_id) DESC LIMIT 1`,
  );
  if (!plan.rows[0]) throw new Error('No subscription plan');
  const hash = bcrypt.hashSync(password, 8);
  const gstA = `27AAAP3N${tag.slice(0, 4)}1Z5`;
  const gstB = `29AAAP3N${tag.slice(0, 4)}1Z6`;
  for (const [id, name, gst] of [
    [A, `P3N A ${tag}`, gstA],
    [B, `P3N B ${tag}`, gstB],
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
    `INSERT INTO customers (id, business_id, name, is_active, current_balance)
     VALUES ($1, $2, $3, true, 100), ($4, $5, $6, true, 80)`,
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
  for (const [biz, supplier, item, fromWh, toWh, owner, mark] of [
    [A, supplierA, itemA, whA1, whA2, ownerA, markA],
    [B, supplierB, itemB, whB1, whB2, ownerB, markB],
  ]) {
    await q('purchase-order',
      `INSERT INTO purchase_orders (id, business_id, supplier_id, order_number, order_date, status, subtotal, grand_total, created_by)
       VALUES ($1, $2, $3, $4, CURRENT_DATE, 'draft', 10, 10, $5)`,
      [randomUUID(), biz, supplier, mark, owner],
    );
    await q('transfer',
      `INSERT INTO stock_transfers (id, business_id, transfer_number, transfer_date, from_location_id, to_location_id, status, notes, created_by)
       VALUES ($1, $2, $3, CURRENT_DATE, $4, $5, 'pending', $6, $7)`,
      [randomUUID(), biz, mark, fromWh, toWh, mark, owner],
    );
    await q('return',
      `INSERT INTO purchase_returns (id, business_id, supplier_id, return_number, return_date, subtotal, grand_total, created_by)
       VALUES ($1, $2, $3, $4, CURRENT_DATE, 10, 10, $5)`,
      [randomUUID(), biz, supplier, mark, owner],
    );
    await q('recurring',
      `INSERT INTO recurring_invoices (id, business_id, customer_id, frequency, start_date, next_run_date, items, notes, created_by)
       VALUES ($1, $2, $3, 'monthly', CURRENT_DATE, CURRENT_DATE, '[]'::jsonb, $4, $5)`,
      [randomUUID(), biz, biz === A ? customerA : customerB, mark, owner],
    );
    await q('adjustment',
      `INSERT INTO inventory_adjustments (
         id, business_id, adjustment_number, adjustment_date, adjustment_type, direction, item_id,
         quantity_change, quantity_before, quantity_after, unit_cost_before, unit_cost_after,
         total_value_before, total_value_after, reason_code, reason_notes, created_by)
       VALUES ($1, $2, $3, CURRENT_DATE, 'QUANTITY', 'INCREASE', $4, 1, 0, 1, 0, 0, 0, 0, 'STOCK_TAKE', $6, $5)`,
      [randomUUID(), biz, mark, item, owner, mark],
    );
  }
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

async function effects(businessId) {
  const row = await pool.query(
    `SELECT
       (SELECT COUNT(*) FROM purchases WHERE business_id = $1)::text AS purchases,
       (SELECT COUNT(*) FROM payments WHERE business_id = $1)::text AS payments,
       (SELECT COUNT(*) FROM journal_entries WHERE business_id = $1)::text AS journals,
       (SELECT COUNT(*) FROM ledger_entry_lines WHERE business_id = $1)::text AS ledger,
       (SELECT COUNT(*) FROM stock_movements WHERE business_id = $1)::text AS stock,
       (SELECT COALESCE(current_balance, 0)::text FROM suppliers WHERE id = $2) AS supplier_balance,
       (SELECT COALESCE(current_balance, 0)::text FROM customers WHERE id = $3) AS customer_balance`,
    [businessId, businessId === A ? supplierA : supplierB, businessId === A ? customerA : customerB],
  );
  return row.rows[0];
}

function startServer() {
  fs.writeFileSync(path.resolve(process.cwd(), 'tests/live/phase3n-server.log'), '');
  server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '-p', String(PORT)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      DB_NAME: 'kh_phase2_test',
      DB_PORT: port,
      DB_SSL: 'false',
      E2E_DISABLE_RATE_LIMIT: 'true',
      NODE_OPTIONS: '--max-old-space-size=8192',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', (chunk) => fs.appendFileSync(path.resolve(process.cwd(), 'tests/live/phase3n-server.log'), chunk));
  server.stderr.on('data', (chunk) => fs.appendFileSync(path.resolve(process.cwd(), 'tests/live/phase3n-server.log'), chunk));
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
  const text = await res.text();
  return { status: res.status, cookie: cookieFrom(res), error: text.includes('error') ? 'login rejected' : '' };
}

async function http(method, route, options = {}) {
  if (server && server.exitCode != null) return { status: 0, text: '', failed: true, reason: 'server exited' };
  const once = async () => {
    const url = new URL(route, BASE);
    for (const [key, value] of Object.entries(options.query || {})) url.searchParams.set(key, String(value));
    const res = await fetch(url, {
      method,
      headers: {
        ...(options.body ? { 'content-type': 'application/json' } : {}),
        ...(options.cookie ? { cookie: options.cookie } : {}),
        ...(options.headers || {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      redirect: 'manual',
      signal: AbortSignal.timeout(90000),
    });
    return { status: res.status, text: await res.text(), failed: false };
  };
  try {
    return await once();
  } catch {
    await new Promise((r) => setTimeout(r, 2000));
    try {
      return await once();
    } catch (error) {
      return { status: 0, text: '', failed: true, reason: error instanceof Error ? error.message : 'request failed' };
    }
  }
}

const spoof = {
  'x-authenticated-user-id': ownerB,
  'x-authenticated-business-id': B,
  'x-authenticated-session-version': '1',
};

const gets = [
  '/api/purchase-orders',
  '/api/stock-transfers',
  '/api/purchase-returns',
  '/api/recurring-invoices',
  '/api/inventory-adjustments',
  '/api/suppliers',
];

function seesOwn(res, own, other) {
  return res.status === 200 && res.text.includes(own) && !res.text.includes(other);
}

function forgedSafe(forged, clean) {
  if (forged.text.includes(markB)) return false;
  if (forged.status === 401 || forged.status === 403) return true;
  return forged.status === 200 && forged.text === clean.text && clean.text.includes(markA) && !clean.text.includes(markB);
}

function purchaseBody(supplierId, bill) {
  return {
    branch_id: branchA,
    supplier_id: supplierId,
    bill_number: bill,
    bill_date: day,
    status: 'draft',
    paid_amount: 0,
    supplier_state_code: '27',
    place_of_supply_state_code: '27',
    rcm_review: 'not_reverse_charge',
    items: [{ item_id: itemA, item_name: markA, hsn_sac: '847130', unit: 'PCS', quantity: 1, unit_price: 10, tax_rate: 0 }],
  };
}

function paymentBody(party, amount = 10) {
  return {
    type: party.customer_id ? 'receivable' : 'payable',
    amount,
    payment_mode: 'cash',
    payment_date: day,
    ...party,
  };
}

function journalBody(debitId, creditId, debit = 10, credit = 10, narration = `P3N-${tag}`) {
  return {
    entry_date: day,
    narration,
    lines: [
      { account_id: debitId, debit, credit: 0 },
      { account_id: creditId, debit: 0, credit },
    ],
  };
}

async function main() {
  await assertDb();
  await seed();
  await startServer();
  console.log(`next dev listening on 127.0.0.1:${PORT}`);
  const sessionA = await login(phoneA);
  const sessionB = await login(phoneB);
  const loginOk = sessionA.status === 200 && sessionA.cookie.includes('khatario_session') && sessionB.status === 200 && sessionB.cookie.includes('khatario_session');
  record(loginOk ? 'PASS' : 'FAIL', 'POST /api/auth/login', 'fixture users only in kh_phase2_test', `A ${sessionA.status} B ${sessionB.status}`);
  if (!loginOk) throw new Error('login failed');

  for (const route of gets) {
    const anon = await http('GET', route, { query: { business_id: B, user_id: ownerB }, headers: spoof });
    if (anon.failed) {
      record('BLOCKED', `GET ${route}`, 'no session', anon.reason || 'request failed');
      record('BLOCKED', `GET ${route}`, 'business A own records', 'server did not answer');
      record('BLOCKED', `GET ${route}`, 'business B own records', 'server did not answer');
      record('BLOCKED', `GET ${route}`, 'session A forged query', 'server did not answer');
      continue;
    }
    record(anon.status === 401 && !anon.text.includes(markA) && !anon.text.includes(markB) ? 'PASS' : 'FAIL', `GET ${route}`, 'no session', `HTTP ${anon.status}`);
    const clean = await http('GET', route, { cookie: sessionA.cookie, query: { business_id: A, user_id: ownerA } });
    const forged = await http('GET', route, { cookie: sessionA.cookie, query: { business_id: B, user_id: ownerB }, headers: spoof });
    const ownB = await http('GET', route, { cookie: sessionB.cookie, query: { business_id: B, user_id: ownerB } });
    if (clean.failed || forged.failed || ownB.failed) {
      record('BLOCKED', `GET ${route}`, 'business A own records', clean.failed ? (clean.reason || 'request failed') : `HTTP ${clean.status}`);
      record('BLOCKED', `GET ${route}`, 'business B own records', ownB.failed ? (ownB.reason || 'request failed') : `HTTP ${ownB.status}`);
      record('BLOCKED', `GET ${route}`, 'session A forged query', forged.failed ? (forged.reason || 'request failed') : `HTTP ${forged.status}`);
      continue;
    }
    const bVisible = seesOwn(ownB, markB, markA);
    if (!bVisible) {
      record('BLOCKED', `GET ${route}`, 'business B own records', `HTTP ${ownB.status} ${brief(ownB.text)}`);
      record('BLOCKED', `GET ${route}`, 'business A own records', `HTTP ${clean.status} ${brief(clean.text)}`);
      record(forged.text.includes(markB) ? 'FAIL' : 'BLOCKED', `GET ${route}`, 'session A forged query', `HTTP ${forged.status} ${brief(forged.text)}`);
    } else {
      record(seesOwn(clean, markA, markB) ? 'PASS' : 'FAIL', `GET ${route}`, 'business A own records', `HTTP ${clean.status}`);
      record('PASS', `GET ${route}`, 'business B own records', `HTTP ${ownB.status}`);
      const leaked = forged.text.includes(markB);
      const same = forged.text === clean.text;
      const level = forgedSafe(forged, clean) ? 'PASS' : (leaked ? 'FAIL' : 'BLOCKED');
      record(level, `GET ${route}`, 'session A forged query', `HTTP ${forged.status} leaked ${leaked} same ${same} html ${forged.text.trim().startsWith('<')}`);
    }
  }

  const beforeB = await effects(B);
  const anonWrites = [
    ['POST', '/api/purchases', { ...purchaseBody(supplierB, `${markB}-anon`), business_id: B, user_id: ownerB, created_by: ownerB }],
    ['POST', '/api/payments', { ...paymentBody({ customer_id: customerB }), business_id: B, user_id: ownerB, created_by: ownerB }],
    ['POST', '/api/journal-entries', { ...journalBody(debitB, creditB, 10, 10, `${markB}-anon`), business_id: B, created_by: ownerB }],
  ];
  for (const [method, route, body] of anonWrites) {
    const res = await http(method, route, { body, query: { business_id: B, user_id: ownerB }, headers: spoof });
    const after = await effects(B);
    const ok = res.status === 401 && JSON.stringify(after) === JSON.stringify(beforeB) && !res.text.includes(markB);
    record(ok ? 'PASS' : 'FAIL', `${method} ${route}`, 'no session', `HTTP ${res.status} ${brief(res.text)} bUnchanged ${JSON.stringify(after) === JSON.stringify(beforeB)}`);
  }

  const identityWrites = [
    ['POST', '/api/purchases', { ...purchaseBody(supplierA, `${markA}-id`), business_id: B, user_id: ownerB, created_by: ownerB }, 'purchases', `${markA}-id`],
    ['POST', '/api/payments', { ...paymentBody({ customer_id: customerA }, 3), business_id: B, user_id: ownerB, created_by: ownerB }, 'payments', null],
    ['POST', '/api/journal-entries', { ...journalBody(debitA, creditA, 10, 10, `${markA}-id`), business_id: B, created_by: ownerB }, 'journal_entries', `${markA}-id`],
  ];
  for (const [method, route, body, table, token] of identityWrites) {
    const before = await effects(B);
    const beforeA = await effects(A);
    const res = await http(method, route, { cookie: sessionA.cookie, body, query: { business_id: B, user_id: ownerB }, headers: spoof });
    const after = await effects(B);
    const bSame = JSON.stringify(after) === JSON.stringify(before);
    let onB = false;
    if (table === 'purchases') {
      const row = await pool.query(`SELECT business_id FROM purchases WHERE bill_number = $1`, [token]);
      onB = row.rows.some((item) => item.business_id === B);
    } else if (table === 'journal_entries') {
      const row = await pool.query(`SELECT business_id FROM journal_entries WHERE narration = $1`, [token]);
      onB = row.rows.some((item) => item.business_id === B);
    } else {
      onB = JSON.stringify(await effects(A)) !== JSON.stringify(beforeA) && !bSame;
    }
    const rejected = (res.status === 401 || res.status === 403 || (res.status === 400 && bSame)) && bSame && !onB;
    const storedOnA = res.status === 201 && bSame && !onB && !res.text.includes(markB);
    record(rejected || storedOnA ? 'PASS' : 'FAIL', `${method} ${route}`, 'session A body names B', `HTTP ${res.status} ${brief(res.text)} bUnchanged ${bSame}`);
  }

  const foreign = [
    ['POST', '/api/purchases', purchaseBody(supplierB, `${markA}-foreign-bill`), 'B supplier'],
    ['POST', '/api/payments', paymentBody({ customer_id: customerB }), 'B customer'],
    ['POST', '/api/payments', paymentBody({ supplier_id: supplierB }), 'B supplier'],
    ['POST', '/api/journal-entries', journalBody(debitB, creditB, 10, 10, `${markA}-foreign-j`), 'B accounts'],
  ];
  for (const [method, route, body, label] of foreign) {
    const before = await effects(B);
    const beforePurchases = before.purchases;
    const res = await http(method, route, { cookie: sessionA.cookie, body, query: { business_id: B }, headers: spoof });
    const after = await effects(B);
    const bSame = JSON.stringify(after) === JSON.stringify(before);
    const ownership = /SUPPLIER_INVALID|PAYMENT_PARTY_NOT_FOUND|ACCOUNT_NOT_IN_BUSINESS|NOT_FOUND|does not belong|does not match/i.test(`${brief(res.text)} ${res.text.slice(0, 180)}`);
    const authReject = bSame && (res.status === 401 || res.status === 403 || (res.status === 404 && ownership) || (res.status === 400 && ownership));
    const level = authReject ? 'PASS' : (bSame && res.status >= 500 ? 'BLOCKED' : 'FAIL');
    record(level, `${method} ${route}`, `session A references ${label}`, `HTTP ${res.status} ${brief(res.text)} bUnchanged ${bSame} purchases ${beforePurchases}`);
  }

  const beforeBad = await effects(A);
  const beforeBadB = await effects(B);
  const unbalanced = await http('POST', '/api/journal-entries', {
    cookie: sessionA.cookie,
    body: journalBody(debitA, creditA, 10, 4, `${markA}-unbalanced`),
  });
  const afterBad = await effects(A);
  const afterBadB = await effects(B);
  const leftover = await pool.query(`SELECT COUNT(*)::int AS n FROM journal_entries WHERE narration = $1`, [`${markA}-unbalanced`]);
  const unbalancedOk = unbalanced.status === 400 && JSON.stringify(afterBad) === JSON.stringify(beforeBad) && JSON.stringify(afterBadB) === JSON.stringify(beforeBadB) && leftover.rows[0].n === 0;
  record(unbalancedOk ? 'PASS' : 'FAIL', 'POST /api/journal-entries', 'unbalanced entry', `HTTP ${unbalanced.status} ${brief(unbalanced.text)} leftover ${leftover.rows[0].n}`);

  const beforeOwnB = await effects(B);
  const ownPurchase = await http('POST', '/api/purchases', { cookie: sessionA.cookie, body: purchaseBody(supplierA, `${markA}-own-bill`) });
  const ownPayment = await http('POST', '/api/payments', { cookie: sessionA.cookie, body: paymentBody({ customer_id: customerA }, 2) });
  const ownJournal = await http('POST', '/api/journal-entries', { cookie: sessionA.cookie, body: journalBody(debitA, creditA, 11, 11, `${markA}-own-j`) });
  const afterOwnA = await effects(A);
  const afterOwnB = await effects(B);
  const purchaseRow = await pool.query(`SELECT business_id FROM purchases WHERE bill_number = $1`, [`${markA}-own-bill`]);
  const journalRow = await pool.query(
    `SELECT j.business_id,
        (SELECT COALESCE(SUM(l.debit), 0)::text FROM ledger_entry_lines l
          WHERE l.business_id = j.business_id AND l.voucher_type = 'journal' AND l.voucher_id = j.voucher_id) AS debit,
        (SELECT COALESCE(SUM(l.credit), 0)::text FROM ledger_entry_lines l
          WHERE l.business_id = j.business_id AND l.voucher_type = 'journal' AND l.voucher_id = j.voucher_id) AS credit
     FROM journal_entries j WHERE j.narration = $1`,
    [`${markA}-own-j`],
  );
  const bUntouched = JSON.stringify(afterOwnB) === JSON.stringify(beforeOwnB);
  record(ownPurchase.status === 201 && purchaseRow.rows.length === 1 && purchaseRow.rows[0].business_id === A && bUntouched ? 'PASS' : 'FAIL', 'POST /api/purchases', 'session A own bill', `HTTP ${ownPurchase.status} ${brief(ownPurchase.text)} bUnchanged ${bUntouched}`);
  record(ownPayment.status === 201 && Number(afterOwnA.payments) > 0 && bUntouched ? 'PASS' : 'FAIL', 'POST /api/payments', 'session A own receipt', `HTTP ${ownPayment.status} ${brief(ownPayment.text)} bUnchanged ${bUntouched}`);
  const journalBalanced = journalRow.rows.length === 1 && journalRow.rows[0].business_id === A && journalRow.rows[0].debit === journalRow.rows[0].credit && Number(journalRow.rows[0].debit) > 0;
  record(ownJournal.status === 201 && journalBalanced && bUntouched ? 'PASS' : 'FAIL', 'POST /api/journal-entries', 'session A balanced entry', `HTTP ${ownJournal.status} ${brief(ownJournal.text)} bUnchanged ${bUntouched}`);

  await pool.query(`UPDATE users SET auth_session_version = 2 WHERE id = $1`, [ownerA]);
  const beforeStale = await effects(B);
  for (const route of gets) {
    const stale = await http('GET', route, { cookie: sessionA.cookie, query: { business_id: B, user_id: ownerB }, headers: spoof });
    const leaked = stale.text.includes(markA) || stale.text.includes(markB);
    record(stale.status === 401 && !leaked ? 'PASS' : 'FAIL', `GET ${route}`, 'stale session', `HTTP ${stale.status} leaked ${leaked}`);
  }
  for (const [method, route, body] of anonWrites) {
    const stale = await http(method, route, { cookie: sessionA.cookie, body, query: { business_id: B }, headers: spoof });
    record(stale.status === 401 && !stale.text.includes(markB) ? 'PASS' : 'FAIL', `${method} ${route}`, 'stale session', `HTTP ${stale.status}`);
  }
  const afterStale = await effects(B);
  record(JSON.stringify(afterStale) === JSON.stringify(beforeStale) ? 'PASS' : 'FAIL', 'stale writes', 'business B unchanged', 'compared purchases payments journals ledger stock and balances');

  const failed = results.filter((row) => row.level === 'FAIL').length;
  const blocked = results.filter((row) => row.level === 'BLOCKED').length;
  const passed = results.filter((row) => row.level === 'PASS').length;
  console.log(`SUMMARY pass=${passed} fail=${failed} blocked=${blocked}`);
  if (failed) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(`BLOCKED ${error instanceof Error ? error.message : 'live HTTP failed'}${server && server.exitCode != null ? ` server-exit ${server.exitCode}` : ''}`);
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
