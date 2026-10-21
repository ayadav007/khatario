/**
 * Phase 3O live HTTP check for the four handlers fixed after Phase 3N.
 * Does not change the Phase 3M or Phase 3N scripts.
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
const PORT = 3110;
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
const tag = A.slice(0, 8);
const markA = `P3OA-${tag}`;
const markB = `P3OB-${tag}`;
const password = `Qa${randomBytes(9).toString('hex')}!`;
const phoneA = `91${Date.now().toString().slice(-8)}5`;
const phoneB = `91${Date.now().toString().slice(-8)}6`;
let debitA;
let creditA;
let debitB;
let creditB;

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

function codeOf(text) {
  try {
    return JSON.parse(text).code || '';
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
    await client.query(`DELETE FROM purchase_return_items WHERE return_id IN (SELECT id FROM purchase_returns WHERE business_id = ANY($1::uuid[]))`, [ids]);
    await client.query(`DELETE FROM purchase_returns WHERE business_id = ANY($1::uuid[])`, [ids]);
    await client.query(`DELETE FROM purchase_order_items WHERE purchase_order_id IN (SELECT id FROM purchase_orders WHERE business_id = ANY($1::uuid[]))`, [ids]);
    await client.query(`DELETE FROM purchase_orders WHERE business_id = ANY($1::uuid[])`, [ids]);
    await client.query(`DELETE FROM recurring_invoices WHERE business_id = ANY($1::uuid[])`, [ids]);
    for (const id of ids) {
      await client.query(`DELETE FROM user_branches WHERE user_id IN (SELECT id FROM users WHERE business_id = $1)`, [id]);
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
  const orphans = await pool.query(`SELECT id FROM businesses WHERE name LIKE 'P3O %'`);
  if (orphans.rows.length) await purge(orphans.rows.map((row) => row.id));
  const plan = await pool.query(
    `SELECT plan_id FROM subscription_plan_features
      WHERE enabled = true AND feature_id IN ('purchase_management','sales_recurring_invoices','advanced_ledger')
      GROUP BY plan_id ORDER BY COUNT(DISTINCT feature_id) DESC LIMIT 1`,
  );
  if (!plan.rows[0]) throw new Error('No subscription plan');
  const hash = bcrypt.hashSync(password, 8);
  for (const [id, name, gst] of [
    [A, `P3O A ${tag}`, `27AAAP3O${tag.slice(0, 4)}1Z5`],
    [B, `P3O B ${tag}`, `29AAAP3O${tag.slice(0, 4)}1Z6`],
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
    `INSERT INTO customers (id, business_id, name, is_active) VALUES ($1, $2, $3, true), ($4, $5, $6, true)`,
    [customerA, A, markA, customerB, B, markB],
  );
  await pool.query(
    `INSERT INTO suppliers (id, business_id, name, is_active, state_code) VALUES ($1, $2, $3, true, '27'), ($4, $5, $6, true, '29')`,
    [supplierA, A, markA, supplierB, B, markB],
  );
  for (const [biz, supplier, customer, owner, mark] of [
    [A, supplierA, customerA, ownerA, markA],
    [B, supplierB, customerB, ownerB, markB],
  ]) {
    await pool.query(
      `INSERT INTO purchase_orders (id, business_id, supplier_id, order_number, order_date, status, subtotal, grand_total, created_by)
       VALUES ($1, $2, $3, $4, CURRENT_DATE, 'draft', 10, 10, $5)`,
      [randomUUID(), biz, supplier, mark, owner],
    );
    await pool.query(
      `INSERT INTO purchase_returns (id, business_id, supplier_id, return_number, return_date, subtotal, grand_total, created_by)
       VALUES ($1, $2, $3, $4, CURRENT_DATE, 10, 10, $5)`,
      [randomUUID(), biz, supplier, mark, owner],
    );
    await pool.query(
      `INSERT INTO recurring_invoices (id, business_id, customer_id, frequency, start_date, next_run_date, items, notes, created_by)
       VALUES ($1, $2, $3, 'monthly', CURRENT_DATE, CURRENT_DATE, '[]'::jsonb, $4, $5)`,
      [randomUUID(), biz, customer, mark, owner],
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

async function ledgerCount(businessId) {
  const row = await pool.query(
    `SELECT
       (SELECT COUNT(*) FROM journal_entries WHERE business_id = $1)::text AS journals,
       (SELECT COUNT(*) FROM ledger_entry_lines WHERE business_id = $1)::text AS ledger`,
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

function journalBody(debitId, creditId, debit, credit, narration) {
  return {
    entry_date: day,
    narration,
    business_id: B,
    created_by: ownerB,
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
  const loginOk = sessionA.status === 200 && sessionA.cookie.includes('khatario_session') && sessionB.status === 200;
  record(loginOk ? 'PASS' : 'FAIL', 'POST /api/auth/login', 'fixture users', `A ${sessionA.status} B ${sessionB.status}`);
  if (!loginOk) throw new Error('login failed');

  const gets = ['/api/purchase-orders', '/api/purchase-returns', '/api/recurring-invoices'];
  for (const route of gets) {
    const anon = await http('GET', route, { query: { business_id: B, user_id: ownerB }, headers: spoof });
    record(anon.status === 401 && !anon.text.includes(markA) && !anon.text.includes(markB) ? 'PASS' : 'FAIL', `GET ${route}`, 'no session', `HTTP ${anon.status} ${brief(anon.text)}`);
    const clean = await http('GET', route, { cookie: sessionA.cookie, query: { business_id: A, user_id: ownerA } });
    const forged = await http('GET', route, { cookie: sessionA.cookie, query: { business_id: B, user_id: ownerB }, headers: spoof });
    const ownB = await http('GET', route, { cookie: sessionB.cookie, query: { business_id: B, user_id: ownerB } });
    const ownOk = clean.status === 200 && clean.text.includes(markA) && !clean.text.includes(markB) && ownB.status === 200 && ownB.text.includes(markB) && !ownB.text.includes(markA);
    record(ownOk ? 'PASS' : 'FAIL', `GET ${route}`, 'own records', `A ${clean.status} B ${ownB.status}`);
    const isolated = !forged.text.includes(markB) && (forged.status === 403 || (forged.status === 200 && forged.text === clean.text && clean.text.includes(markA)));
    record(isolated ? 'PASS' : 'FAIL', `GET ${route}`, 'session A forged query', `HTTP ${forged.status} leaked ${forged.text.includes(markB)}`);
  }

  const beforeAnon = await ledgerCount(B);
  const anonJournal = await http('POST', '/api/journal-entries', {
    body: journalBody(debitB, creditB, 10, 10, `${markB}-anon`),
    query: { business_id: B, user_id: ownerB },
    headers: spoof,
  });
  const afterAnon = await ledgerCount(B);
  record(anonJournal.status === 401 && JSON.stringify(afterAnon) === JSON.stringify(beforeAnon) ? 'PASS' : 'FAIL', 'POST /api/journal-entries', 'no session', `HTTP ${anonJournal.status} ${brief(anonJournal.text)}`);

  const beforeNamed = await ledgerCount(B);
  const named = await http('POST', '/api/journal-entries', {
    cookie: sessionA.cookie,
    body: journalBody(debitA, creditA, 10, 10, `${markA}-named-b`),
    query: { business_id: B },
    headers: spoof,
  });
  const namedRows = await pool.query(`SELECT business_id FROM journal_entries WHERE narration = $1`, [`${markA}-named-b`]);
  record(named.status === 403 && namedRows.rows.length === 0 && JSON.stringify(await ledgerCount(B)) === JSON.stringify(beforeNamed) ? 'PASS' : 'FAIL', 'POST /api/journal-entries', 'session A body names B', `HTTP ${named.status} ${brief(named.text)}`);

  const beforeForeign = await ledgerCount(A);
  const foreign = await http('POST', '/api/journal-entries', {
    cookie: sessionA.cookie,
    body: { entry_date: day, narration: `${markA}-foreign`, lines: [{ account_id: debitB, debit: 10, credit: 0 }, { account_id: creditB, debit: 0, credit: 10 }] },
  });
  record(foreign.status === 403 && codeOf(foreign.text) === 'ACCOUNT_NOT_IN_BUSINESS' && JSON.stringify(await ledgerCount(A)) === JSON.stringify(beforeForeign) ? 'PASS' : 'FAIL', 'POST /api/journal-entries', 'session A uses B accounts', `HTTP ${foreign.status} ${brief(foreign.text)}`);

  const unbalanced = await http('POST', '/api/journal-entries', {
    cookie: sessionA.cookie,
    body: { entry_date: day, narration: `${markA}-bad`, lines: [{ account_id: debitA, debit: 10, credit: 0 }, { account_id: creditA, debit: 0, credit: 4 }] },
  });
  const badRows = await pool.query(`SELECT COUNT(*)::int AS n FROM journal_entries WHERE narration = $1`, [`${markA}-bad`]);
  record(unbalanced.status === 400 && badRows.rows[0].n === 0 ? 'PASS' : 'FAIL', 'POST /api/journal-entries', 'unbalanced', `HTTP ${unbalanced.status}`);

  const own = await http('POST', '/api/journal-entries', {
    cookie: sessionA.cookie,
    body: { entry_date: day, narration: `${markA}-own`, lines: [{ account_id: debitA, debit: 11, credit: 0 }, { account_id: creditA, debit: 0, credit: 11 }] },
  });
  const ownRow = await pool.query(
    `SELECT j.business_id,
        (SELECT COALESCE(SUM(l.debit), 0)::text FROM ledger_entry_lines l WHERE l.voucher_type = 'journal' AND l.voucher_id = j.voucher_id) AS debit,
        (SELECT COALESCE(SUM(l.credit), 0)::text FROM ledger_entry_lines l WHERE l.voucher_type = 'journal' AND l.voucher_id = j.voucher_id) AS credit
     FROM journal_entries j WHERE j.narration = $1`,
    [`${markA}-own`],
  );
  const balanced = ownRow.rows.length === 1 && ownRow.rows[0].business_id === A && ownRow.rows[0].debit === ownRow.rows[0].credit && Number(ownRow.rows[0].debit) > 0;
  record(own.status === 201 && balanced ? 'PASS' : 'FAIL', 'POST /api/journal-entries', 'session A own entry', `HTTP ${own.status}`);

  await pool.query(`UPDATE users SET auth_session_version = 2 WHERE id = $1`, [ownerA]);
  const beforeStale = await ledgerCount(B);
  for (const route of gets) {
    const stale = await http('GET', route, { cookie: sessionA.cookie, query: { business_id: B, user_id: ownerB }, headers: spoof });
    const ok = stale.status === 401 && codeOf(stale.text) === 'SESSION_REVOKED' && !stale.text.includes(markA) && !stale.text.includes(markB);
    record(ok ? 'PASS' : 'FAIL', `GET ${route}`, 'stale session', `HTTP ${stale.status} ${brief(stale.text)}`);
  }
  const staleJournal = await http('POST', '/api/journal-entries', {
    cookie: sessionA.cookie,
    body: journalBody(debitB, creditB, 10, 10, `${markB}-stale`),
    query: { business_id: B },
    headers: spoof,
  });
  const staleRows = await pool.query(`SELECT COUNT(*)::int AS n FROM journal_entries WHERE narration = $1`, [`${markB}-stale`]);
  const staleOk = staleJournal.status === 401 && codeOf(staleJournal.text) === 'SESSION_REVOKED' && staleRows.rows[0].n === 0 && JSON.stringify(await ledgerCount(B)) === JSON.stringify(beforeStale);
  record(staleOk ? 'PASS' : 'FAIL', 'POST /api/journal-entries', 'stale session', `HTTP ${staleJournal.status} ${brief(staleJournal.text)}`);

  const failed = results.filter((row) => row.level === 'FAIL').length;
  const passed = results.filter((row) => row.level === 'PASS').length;
  console.log(`SUMMARY pass=${passed} fail=${failed}`);
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
