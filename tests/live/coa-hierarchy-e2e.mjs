/**
 * Local browser run of e2e/account-create-hierarchy.spec.ts.
 * Starts Next against kh_phase2_test only. Does not print credentials or the database URL.
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
  throw new Error('Refusing browser run: database host is not local');
}
const port = envFile.DB_PORT || '5432';
const databaseUrl = `postgresql://${encodeURIComponent(envFile.DB_USER)}:${encodeURIComponent(envFile.DB_PASSWORD)}@${host}:${port}/kh_phase2_test`;
const PORT = 3119;
const BASE = `http://127.0.0.1:${PORT}`;
const businessId = randomUUID();
const userId = randomUUID();
const tag = businessId.slice(0, 8);
const phone = `9${Date.now().toString().slice(-9)}`;
const password = `Qa${tag}!coa`;

let server;
let client;

async function purge() {
  if (!client) return;
  await client.query('BEGIN');
  try {
    await client.query(
      `SELECT set_config('khatario.ledger_delete_reason', 'admin:seed_demo', true),
              set_config('khatario.actor_id', '', true)`,
    );
    await client.query(`DELETE FROM ledger_entry_lines WHERE business_id = $1`, [businessId]);
    await client.query(`DELETE FROM ledger_entries WHERE business_id = $1`, [businessId]);
    await client.query(`DELETE FROM journal_entries WHERE business_id = $1`, [businessId]);
    await client.query(`DELETE FROM activity_logs WHERE business_id = $1`, [businessId]);
    await client.query(`DELETE FROM accounts WHERE business_id = $1`, [businessId]);
    await client.query(`DELETE FROM account_groups WHERE business_id = $1`, [businessId]);
    await client.query(`DELETE FROM user_branches WHERE user_id = $1`, [userId]);
    await client.query(`DELETE FROM users WHERE id = $1`, [userId]);
    await client.query(`DELETE FROM branches WHERE business_id = $1`, [businessId]);
    await client.query(`DELETE FROM business_module_subscriptions WHERE business_id = $1`, [businessId]);
    await client.query(`DELETE FROM business_modules WHERE business_id = $1`, [businessId]);
    await client.query(`DELETE FROM businesses WHERE id = $1`, [businessId]);
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
      DB_PORT: port,
      DB_SSL: 'false',
      E2E_DISABLE_RATE_LIMIT: 'true',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const logStream = fs.createWriteStream(path.resolve(process.cwd(), 'tests/live/coa-e2e-server.log'), { flags: 'w' });
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

async function main() {
  client = new Client({ connectionString: databaseUrl });
  await client.connect();
  const db = await client.query(`SELECT current_database() AS db, inet_server_addr()::text AS addr, inet_server_port() AS port`);
  const info = db.rows[0];
  if (info.db !== 'kh_phase2_test' || Number(info.port) !== 5433 || !String(info.addr).includes('127.0.0.1') && !String(info.addr).includes('::1')) {
    throw new Error(`Refusing browser run against ${info.db} at ${info.addr}:${info.port}`);
  }
  console.log(`database ${info.db} loopback port ${info.port}`);
  const plan = await client.query(
    `SELECT plan_id FROM subscription_plan_features
      WHERE enabled = true AND feature_id = 'accounting_chart'
      LIMIT 1`,
  );
  if (!plan.rows[0]) throw new Error('No plan grants accounting_chart');
  const gst = `27COAEX${tag.slice(0, 4)}A1Z5`;
  await client.query(
    `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type, primary_module)
     VALUES ($1, $2, $3, '27', 'regular', 'billing')`,
    [businessId, `COA-E2E ${tag}`, gst],
  );
  await client.query(
    `INSERT INTO business_modules (business_id, module_key, enabled, source) VALUES ($1, 'billing', true, 'test')`,
    [businessId],
  );
  await client.query(
    `INSERT INTO business_module_subscriptions (business_id, module_key, plan_id, status, start_date, end_date)
     VALUES ($1, 'billing', $2, 'active', CURRENT_DATE, CURRENT_DATE + 30)`,
    [businessId, plan.rows[0].plan_id],
  );
  await client.query(`SELECT create_default_chart_of_accounts($1)`, [businessId]);
  await client.query(
    `INSERT INTO branches (id, business_id, name, state_code, is_default, is_active)
     VALUES ($1, $2, 'Main', '27', true, true)`,
    [randomUUID(), businessId],
  );
  await client.query(
    `INSERT INTO users (id, business_id, name, phone, password_hash, is_primary_admin, auth_session_version, is_active, product_tour_completed_at)
     VALUES ($1, $2, $3, $4, $5, true, 1, true, NOW())`,
    [userId, businessId, `COA E2E ${tag}`, phone, bcrypt.hashSync(password, 8)],
  );

  await startServer();
  console.log(`next dev listening on 127.0.0.1:${PORT}`);
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ phone, password }),
  });
  if (login.status !== 200) {
    throw new Error(`Login probe failed with HTTP ${login.status}`);
  }
  console.log('login probe 200');
  const cookie = (typeof login.headers.getSetCookie === 'function' ? login.headers.getSetCookie() : [])
    .map((part) => part.split(';')[0])
    .join('; ');
  for (const path of [
    '/login',
    '/accounts/new',
    '/accounts',
    '/dashboard',
    '/api/accounts?limit=1',
    '/api/accounts/groups',
    '/api/auth/session',
    '/api/businesses/my',
    '/api/subscriptions/current',
    '/api/subscriptions/check-limit',
    '/api/subscriptions/trial-extension',
    '/api/features/enabled',
    '/api/todos',
    '/api/suppliers/dashboard',
  ]) {
    const warmed = await fetch(`${BASE}${path}`, { headers: cookie ? { cookie } : {} });
    console.log(`warm ${path} ${warmed.status}`);
  }
  const probe = await fetch(`${BASE}/api/accounts`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({
      created_by: userId,
      account_code: `PRB${tag}`,
      account_name: `Probe ${tag}`,
      account_type: 'expense',
      account_group_id: (await client.query(`SELECT id FROM account_groups WHERE business_id = $1 AND group_code = '5200'`, [businessId])).rows[0].id,
      nature: 'debit',
      opening_balance: 0,
      opening_balance_type: 'debit',
    }),
    signal: AbortSignal.timeout(25000),
  }).catch((error) => ({ status: 0, error: error instanceof Error ? error.name : 'probe failed' }));
  if (probe.error) {
    console.log(`account post probe ${probe.error}`);
    const log = fs.readFileSync(path.resolve(process.cwd(), 'tests/live/coa-e2e-server.log'), 'utf8');
    console.log(log.slice(-2000).replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[redacted]'));
    process.exitCode = 1;
    return;
  }
  const probeText = await probe.text();
  console.log(`account post probe ${probe.status} ${probeText.slice(0, 180).replace(/[A-Za-z0-9_-]{20,}/g, '[redacted]')}`);
  if (probe.status !== 201) {
    process.exitCode = 1;
    return;
  }

  const exitCode = await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['node_modules/playwright/cli.js', 'test', 'e2e/my-accounts.spec.ts', 'e2e/account-create-hierarchy.spec.ts', '--project=chromium', '--retries=0'],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          PLAYWRIGHT_BASE_URL: BASE,
          PLAYWRIGHT_SKIP_WEBSERVER: '1',
          E2E_TEST_PHONE: phone,
          E2E_TEST_PASSWORD: password,
        },
        stdio: 'inherit',
      },
    );
    child.on('exit', (code) => resolve(code ?? 1));
    child.on('error', reject);
  });
  console.log(`playwright exit ${exitCode}`);
  if (exitCode !== 0) process.exitCode = exitCode;
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : 'browser run failed');
    process.exitCode = 1;
  })
  .finally(async () => {
    stopServer();
    try {
      if (client) {
        await purge();
        const left = await client.query(`SELECT COUNT(*)::int AS n FROM businesses WHERE name LIKE 'COA-E2E %'`);
        console.log(`leftover COA-E2E businesses ${left.rows[0].n}`);
        await client.end();
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : 'cleanup failed');
      process.exitCode = 1;
    }
  });
