/**
 * Live HTTP check of trial balance and balance sheet.
 * Next.js on 127.0.0.1:3121, database kh_phase2_test only.
 * Does not print credentials, cookies, or the database URL.
 */
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { Client } from 'pg';
import bcrypt from 'bcryptjs';

function readEnvFile(file) {
  const out = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
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
  throw new Error('Refusing report HTTP run: database host is not local');
}
const dbPort = envFile.DB_PORT || '5432';
const databaseUrl = `postgresql://${encodeURIComponent(envFile.DB_USER)}:${encodeURIComponent(envFile.DB_PASSWORD)}@${host}:${dbPort}/kh_phase2_test`;
const PORT = 3121;
const BASE = `http://127.0.0.1:${PORT}`;
const DAY = '2026-10-19';
const A = randomUUID();
const B = randomUUID();
const ownerA = randomUUID();
const ownerB = randomUUID();
const tag = A.slice(0, 8);
const phoneA = `9${Date.now().toString().slice(-9)}`;
const phoneB = `8${Date.now().toString().slice(-9)}`;
const password = `Qa${tag}!rpt`;

let server;
let client;
const checks = [];

function record(name, ok, detail = '') {
  checks.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` ${detail}` : ''}`);
}

function cookieHeader(res) {
  const parts = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  return parts.map((part) => part.split(';')[0]).join('; ');
}

async function login(phone) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ phone, password }),
  });
  return { status: res.status, cookie: cookieHeader(res) };
}

async function api(cookie, method, urlPath, body, extraHeaders = {}) {
  const res = await fetch(`${BASE}${urlPath}`, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(cookie ? { cookie } : {}),
      ...extraHeaders,
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(90000),
  });
  const text = await res.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { error: 'response was not JSON' };
  }
  return { status: res.status, json };
}

function shortError(json) {
  const message = typeof json.error === 'string' ? json.error : json.code || 'no error message';
  return String(message).slice(0, 160);
}

async function purge(ids) {
  await client.query('BEGIN');
  try {
    await client.query(
      `SELECT set_config('khatario.ledger_delete_reason', 'admin:seed_demo', true),
              set_config('khatario.actor_id', '', true)`,
    );
    await client.query(`DELETE FROM ledger_entry_lines WHERE business_id = ANY($1::uuid[])`, [ids]);
    await client.query(`DELETE FROM ledger_entries WHERE business_id = ANY($1::uuid[])`, [ids]);
    await client.query(`DELETE FROM journal_entries WHERE business_id = ANY($1::uuid[])`, [ids]);
    await client.query(`DELETE FROM activity_logs WHERE business_id = ANY($1::uuid[])`, [ids]);
    await client.query(`DELETE FROM accounts WHERE business_id = ANY($1::uuid[])`, [ids]);
    await client.query(`DELETE FROM account_groups WHERE business_id = ANY($1::uuid[])`, [ids]);
    await client.query(`DELETE FROM user_branches WHERE user_id = ANY($1::uuid[])`, [[ownerA, ownerB]]);
    await client.query(`DELETE FROM users WHERE business_id = ANY($1::uuid[])`, [ids]);
    await client.query(`DELETE FROM branches WHERE business_id = ANY($1::uuid[])`, [ids]);
    await client.query(`DELETE FROM business_module_subscriptions WHERE business_id = ANY($1::uuid[])`, [ids]);
    await client.query(`DELETE FROM business_modules WHERE business_id = ANY($1::uuid[])`, [ids]);
    await client.query(`DELETE FROM businesses WHERE id = ANY($1::uuid[])`, [ids]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

function startServer() {
  server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '-H', '127.0.0.1', '-p', String(PORT)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      DB_NAME: 'kh_phase2_test',
      DB_PORT: dbPort,
      DB_SSL: 'false',
      E2E_DISABLE_RATE_LIMIT: 'true',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const logStream = fs.createWriteStream(path.resolve(process.cwd(), 'tests/live/coa-reports-http.log'), { flags: 'w' });
  server.stdout.pipe(logStream);
  server.stderr.pipe(logStream);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Next.js did not become ready')), 180000);
    const wait = async () => {
      const started = Date.now();
      while (Date.now() - started < 180000) {
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
          /* still booting */
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
    };
    wait().catch(reject);
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

async function seedBusiness(id, name, gst, userId, phone) {
  const plan = await client.query(
    `SELECT plan_id FROM subscription_plan_features
      WHERE enabled = true AND feature_id IN ('accounting_chart', 'advanced_ledger', 'reports_advanced')
      GROUP BY plan_id
      HAVING COUNT(DISTINCT feature_id) = 3
      LIMIT 1`,
  );
  if (!plan.rows[0]) throw new Error('No plan grants accounting_chart, advanced_ledger, and reports_advanced');
  await client.query(
    `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type, primary_module)
     VALUES ($1, $2, $3, $4, 'regular', 'billing')`,
    [id, name, gst, gst.slice(0, 2)],
  );
  await client.query(
    `INSERT INTO business_modules (business_id, module_key, enabled, source) VALUES ($1, 'billing', true, 'test')`,
    [id],
  );
  await client.query(
    `INSERT INTO business_module_subscriptions (business_id, module_key, plan_id, status, start_date, end_date)
     VALUES ($1, 'billing', $2, 'active', CURRENT_DATE, CURRENT_DATE + 30)`,
    [id, plan.rows[0].plan_id],
  );
  await client.query(`SELECT create_default_chart_of_accounts($1)`, [id]);
  await client.query(
    `INSERT INTO branches (id, business_id, name, state_code, is_default, is_active)
     VALUES ($1, $2, 'Main', $3, true, true)`,
    [randomUUID(), id, gst.slice(0, 2)],
  );
  await client.query(
    `INSERT INTO users (id, business_id, name, phone, password_hash, is_primary_admin, auth_session_version, is_active)
     VALUES ($1, $2, $3, $4, $5, true, 1, true)`,
    [userId, id, name, phone, bcrypt.hashSync(password, 8)],
  );
}

async function groupId(businessId, code) {
  const row = await client.query(`SELECT id FROM account_groups WHERE business_id = $1 AND group_code = $2`, [businessId, code]);
  if (!row.rows[0]) throw new Error(`Missing group ${code}`);
  return row.rows[0].id;
}

async function accountId(businessId, code) {
  const row = await client.query(`SELECT id FROM accounts WHERE business_id = $1 AND account_code = $2`, [businessId, code]);
  if (!row.rows[0]) throw new Error(`Missing account ${code}`);
  return row.rows[0].id;
}

async function main() {
  client = new Client({ connectionString: databaseUrl });
  await client.connect();
  const db = await client.query(`SELECT current_database() AS db, inet_server_addr()::text AS addr, inet_server_port() AS port`);
  const info = db.rows[0];
  const loopback = String(info.addr).includes('127.0.0.1') || String(info.addr).includes('::1');
  if (info.db !== 'kh_phase2_test' || Number(info.port) !== 5433 || !loopback) {
    throw new Error(`Refusing report HTTP run against ${info.db} at ${info.addr}:${info.port}`);
  }
  console.log(`database ${info.db} loopback port ${info.port}`);
  const orphans = await client.query(`SELECT id FROM businesses WHERE name LIKE 'COA-RPT %'`);
  if (orphans.rows.length) await purge(orphans.rows.map((row) => row.id));

  await seedBusiness(A, `COA-RPT A ${tag}`, `27RPTAX${tag.slice(0, 4)}A1Z5`, ownerA, phoneA);
  await seedBusiness(B, `COA-RPT B ${tag}`, `29RPTAX${tag.slice(0, 4)}A1Z5`, ownerB, phoneB);
  console.log('fixtures COA-RPT A and COA-RPT B');

  await startServer();
  console.log(`next dev listening on 127.0.0.1:${PORT}`);

  const sessionA = await login(phoneA);
  const sessionB = await login(phoneB);
  record('login business A', sessionA.status === 200 && sessionA.cookie.includes('khatario_session='), `HTTP ${sessionA.status}`);
  record('login business B', sessionB.status === 200 && sessionB.cookie.includes('khatario_session='), `HTTP ${sessionB.status}`);
  if (!sessionA.cookie || !sessionB.cookie) return;

  const bareTb = await api('', 'GET', `/api/reports/trial-balance?as_on_date=${DAY}&business_id=${B}`);
  const bareBs = await api('', 'GET', `/api/reports/balance-sheet?as_on_date=${DAY}&business_id=${B}`);
  record('trial balance without a session', bareTb.status === 401, `HTTP ${bareTb.status} ${bareTb.json.code || ''}`);
  record('balance sheet without a session', bareBs.status === 401, `HTTP ${bareBs.status} ${bareBs.json.code || ''}`);
  const spoofTb = await api('', 'GET', `/api/reports/trial-balance?as_on_date=${DAY}&business_id=${B}`, null, {
    'x-authenticated-user-id': ownerB,
    'x-authenticated-business-id': B,
    'x-authenticated-session-version': '1',
  });
  const spoofBs = await api('', 'GET', `/api/reports/balance-sheet?as_on_date=${DAY}&business_id=${B}`, null, {
    'x-authenticated-user-id': ownerB,
    'x-authenticated-business-id': B,
    'x-authenticated-session-version': '1',
  });
  record('trial balance ignores spoofed identity headers', spoofTb.status === 401, `HTTP ${spoofTb.status}`);
  record('balance sheet ignores spoofed identity headers', spoofBs.status === 401, `HTTP ${spoofBs.status}`);

  async function createAccount(cookie, userId, fields) {
    return api(cookie, 'POST', '/api/accounts', { created_by: userId, opening_balance: 0, ...fields });
  }

  const expenseGroup = await groupId(A, '5200');
  const capitalGroup = await groupId(A, '3000');
  const assetGroup = await groupId(A, '1100');
  const parent = await createAccount(sessionA.cookie, ownerA, {
    account_code: `HTE${tag}`,
    account_name: `TB parent ${tag}`,
    account_type: 'expense',
    account_group_id: expenseGroup,
    nature: 'debit',
    opening_balance_type: 'debit',
  });
  const child = await createAccount(sessionA.cookie, ownerA, {
    account_code: `HTC${tag}`,
    account_name: `TB child ${tag}`,
    account_type: 'expense',
    account_group_id: expenseGroup,
    parent_account_id: parent.json.account?.id,
    nature: 'debit',
    opening_balance_type: 'debit',
  });
  record('create expense parent and child', parent.status === 201 && child.status === 201, `HTTP ${parent.status}/${child.status} ${shortError(child.status === 201 ? {} : child.json)}`);

  const cashId = await accountId(A, '1101');
  const foreignJournal = await api(sessionA.cookie, 'POST', '/api/journal-entries', {
    business_id: B,
    entry_date: DAY,
    narration: 'should not post',
    lines: [
      { account_id: child.json.account?.id, debit: 80, credit: 0 },
      { account_id: cashId, debit: 0, credit: 80 },
    ],
  });
  const foreignLines = await client.query(
    `SELECT COUNT(*)::int AS n FROM ledger_entry_lines WHERE business_id = $1 AND account_id = $2`,
    [A, child.json.account?.id || null],
  );
  record('journal body for business B is rejected', foreignJournal.status === 403 && foreignLines.rows[0].n === 0, `HTTP ${foreignJournal.status}`);
  const expenseJournal = await api(sessionA.cookie, 'POST', '/api/journal-entries', {
    entry_date: DAY,
    narration: 'child expense',
    lines: [
      { account_id: child.json.account?.id, debit: 80, credit: 0 },
      { account_id: cashId, debit: 0, credit: 80 },
    ],
  });
  record('expense journal posted to the child', expenseJournal.status === 201, `HTTP ${expenseJournal.status} ${shortError(expenseJournal.json)}`);

  const capitalParent = await createAccount(sessionA.cookie, ownerA, {
    account_code: `HKP${tag}`,
    account_name: `Capital parent ${tag}`,
    account_type: 'capital',
    account_group_id: capitalGroup,
    nature: 'credit',
    opening_balance_type: 'credit',
  });
  const capitalChild = await createAccount(sessionA.cookie, ownerA, {
    account_code: `HKC${tag}`,
    account_name: `Capital child ${tag}`,
    account_type: 'capital',
    account_group_id: capitalGroup,
    parent_account_id: capitalParent.json.account?.id,
    nature: 'credit',
    opening_balance_type: 'credit',
  });
  const capitalJournal = await api(sessionA.cookie, 'POST', '/api/journal-entries', {
    entry_date: DAY,
    narration: 'capital introduced',
    lines: [
      { account_id: cashId, debit: 70, credit: 0 },
      { account_id: capitalChild.json.account?.id, debit: 0, credit: 70 },
    ],
  });
  record('create capital parent and child and post the child', capitalParent.status === 201 && capitalChild.status === 201 && capitalJournal.status === 201, `HTTP ${capitalParent.status}/${capitalChild.status}/${capitalJournal.status} ${shortError(capitalJournal.json)}`);

  const opened = await createAccount(sessionA.cookie, ownerA, {
    account_code: `HTO${tag}`,
    account_name: `Opening ${tag}`,
    account_type: 'asset',
    account_group_id: assetGroup,
    nature: 'debit',
    opening_balance: 20,
    opening_balance_type: 'debit',
  });
  record('opening balance account', opened.status === 201, `HTTP ${opened.status} ${shortError(opened.json)}`);

  const marker = await createAccount(sessionB.cookie, ownerB, {
    account_code: `HTB${tag}`,
    account_name: `Marker ${tag}`,
    account_type: 'expense',
    account_group_id: await groupId(B, '5200'),
    nature: 'debit',
    opening_balance_type: 'debit',
  });
  record('business B marker account', marker.status === 201, `HTTP ${marker.status}`);

  const query = `as_on_date=${DAY}&business_id=${B}`;
  const tb = await api(sessionA.cookie, 'GET', `/api/reports/trial-balance?${query}`, null, {
    'x-authenticated-business-id': B,
  });
  record('trial balance HTTP 200', tb.status === 200, `HTTP ${tb.status} ${shortError(tb.json)}`);
  if (tb.status === 200) {
    const accounts = Array.isArray(tb.json.accounts) ? tb.json.accounts : [];
    const totals = tb.json.totals || {};
    const once = (code) => accounts.filter((row) => row.account_code === code);
    const expenseChild = once(`HTC${tag}`);
    const expenseParent = once(`HTE${tag}`);
    const capitalChildRows = once(`HKC${tag}`);
    const capitalParentRows = once(`HKP${tag}`);
    const openingRows = once(`HTO${tag}`);
    record('trial balance schema', accounts.length > 0 && typeof totals.total_debit === 'number' && typeof totals.total_credit === 'number' && typeof tb.json.is_balanced === 'boolean');
    record('trial balance totals match', Math.abs(totals.total_debit - totals.total_credit) < 0.01 && tb.json.is_balanced === true, `debit ${totals.total_debit} credit ${totals.total_credit}`);
    record('expense child once at debit 80', expenseChild.length === 1 && Math.abs(expenseChild[0].debit - 80) < 0.01 && Math.abs(expenseChild[0].credit) < 0.01);
    record('expense parent once at zero', expenseParent.length === 1 && Math.abs(expenseParent[0].debit) < 0.01 && Math.abs(expenseParent[0].credit) < 0.01);
    record('capital child once at credit 70', capitalChildRows.length === 1 && Math.abs(capitalChildRows[0].credit - 70) < 0.01 && Math.abs(capitalChildRows[0].debit) < 0.01);
    record('capital parent once at zero', capitalParentRows.length === 1 && Math.abs(capitalParentRows[0].debit) < 0.01 && Math.abs(capitalParentRows[0].credit) < 0.01);
    record('opening voucher is in the debit column', openingRows.length === 1 && Math.abs(openingRows[0].debit - 20) < 0.01 && openingRows[0].opening_balance === 0);
    record('trial balance does not include business B', !accounts.some((row) => row.account_code === `HTB${tag}`));
    const ledger = await client.query(
      `SELECT account_code, COALESCE(SUM(debit), 0)::float AS debit, COALESCE(SUM(credit), 0)::float AS credit
         FROM ledger_entry_lines l
         JOIN accounts a ON a.id = l.account_id
        WHERE l.business_id = $1 AND a.account_code = ANY($2::text[])
        GROUP BY account_code`,
      [A, [`HTC${tag}`, `HTE${tag}`, `HKC${tag}`, `HKP${tag}`, `HTO${tag}`]],
    );
    const byCode = new Map(ledger.rows.map((row) => [row.account_code, row]));
    record(
      'trial balance matches the ledger',
      Math.abs((byCode.get(`HTC${tag}`)?.debit || 0) - 80) < 0.01
        && Math.abs((byCode.get(`HTE${tag}`)?.debit || 0)) < 0.01
        && Math.abs((byCode.get(`HKC${tag}`)?.credit || 0) - 70) < 0.01
        && !byCode.has(`HKP${tag}`)
        && Math.abs((byCode.get(`HTO${tag}`)?.debit || 0) - 20) < 0.01,
    );
  }

  const bs = await api(sessionA.cookie, 'GET', `/api/reports/balance-sheet?${query}`, null, {
    'x-authenticated-business-id': B,
  });
  record('balance sheet HTTP 200', bs.status === 200, `HTTP ${bs.status} ${shortError(bs.json)}`);
  if (bs.status === 200) {
    const capitalAccounts = bs.json.equity?.capital?.accounts || [];
    const childLine = capitalAccounts.find((row) => row.account_code === `HKC${tag}`);
    const parentLine = capitalAccounts.find((row) => row.account_code === `HKP${tag}`);
    const summed = capitalAccounts.reduce((sum, row) => sum + Number(row.balance || 0), 0);
    const text = JSON.stringify(bs.json);
    record('balance sheet schema', typeof bs.json.is_balanced === 'boolean' && bs.json.assets && bs.json.liabilities && bs.json.equity?.capital);
    record('balance sheet is balanced', bs.json.is_balanced === true, `difference ${bs.json.difference}`);
    record('capital child balance is 70', !!childLine && Math.abs(childLine.balance - 70) < 0.01, childLine ? String(childLine.balance) : 'missing');
    record('capital parent is not added again', !parentLine || Math.abs(parentLine.balance) < 0.01);
    record('capital total equals the account lines', Math.abs(Number(bs.json.equity.capital.total) - summed) < 0.01);
    record('balance sheet does not include business B', !text.includes(`HTB${tag}`) && !text.includes(`Marker ${tag}`));
    const openingOnSheet = JSON.stringify(bs.json.assets || {}).includes(`HTO${tag}`);
    record('opening asset is on the balance sheet', openingOnSheet);
  }

  await client.query(`UPDATE users SET auth_session_version = auth_session_version + 1 WHERE id = $1`, [ownerA]);
  const revokedTb = await api(sessionA.cookie, 'GET', `/api/reports/trial-balance?as_on_date=${DAY}`);
  const revokedBs = await api(sessionA.cookie, 'GET', `/api/reports/balance-sheet?as_on_date=${DAY}`);
  const leaked = (body) => {
    const text = JSON.stringify(body);
    return text.includes(`HTC${tag}`) || text.includes(`HKC${tag}`) || text.includes(`HTO${tag}`) || text.includes('accounts');
  };
  record(
    'revoked session trial balance',
    revokedTb.status === 401 && revokedTb.json.code === 'SESSION_REVOKED' && !leaked(revokedTb.json),
    `HTTP ${revokedTb.status} ${revokedTb.json.code || shortError(revokedTb.json)}`,
  );
  record(
    'revoked session balance sheet',
    revokedBs.status === 401 && revokedBs.json.code === 'SESSION_REVOKED' && !leaked(revokedBs.json),
    `HTTP ${revokedBs.status} ${revokedBs.json.code || shortError(revokedBs.json)}`,
  );

  const passed = checks.filter((item) => item.ok).length;
  console.log(`SUMMARY pass=${passed} fail=${checks.length - passed}`);
  if (passed !== checks.length) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : 'report HTTP run failed');
    process.exitCode = 1;
  })
  .finally(async () => {
    stopServer();
    try {
      if (client) {
        await purge([A, B]);
        const left = await client.query(`SELECT COUNT(*)::int AS n FROM businesses WHERE name LIKE 'COA-RPT %'`);
        const lines = await client.query(
          `SELECT COUNT(*)::int AS n FROM ledger_entry_lines WHERE business_id = ANY($1::uuid[])`,
          [[A, B]],
        );
        console.log(`leftover COA-RPT businesses ${left.rows[0].n}`);
        console.log(`leftover fixture ledger lines ${lines.rows[0].n}`);
        await client.end();
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : 'cleanup failed');
      process.exitCode = 1;
    }
  });
