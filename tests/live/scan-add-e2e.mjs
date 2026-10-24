/**
 * Local browser run of e2e/scan-add-items.spec.ts.
 * Starts Next against kh_phase2_test only, creates two businesses with their own logins, runs the
 * spec, then checks stock and ledger rows directly and removes everything it made.
 * Does not print credentials or the database URL.
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

/** 12 digits plus the EAN-13 check digit. Prefix 20 is an in-store range no product database lists. */
function ean13(base12) {
  const sum = [...base12].reduce((s, d, i) => s + Number(d) * (i % 2 ? 3 : 1), 0);
  return base12 + ((10 - (sum % 10)) % 10);
}

const envFile = readEnvFile(path.resolve(process.cwd(), '.env'));
const host = envFile.DB_HOST || '';
if (host !== 'localhost' && host !== '127.0.0.1' && host !== '::1') {
  throw new Error('Refusing browser run: database host is not local');
}
const port = envFile.DB_PORT || '5432';
const databaseUrl = `postgresql://${encodeURIComponent(envFile.DB_USER)}:${encodeURIComponent(envFile.DB_PASSWORD)}@${host}:${port}/kh_phase2_test`;
const PORT = 3131;
const BASE = `http://127.0.0.1:${PORT}`;
const tag = randomUUID().slice(0, 8);
const digits = Date.now().toString().slice(-8);
const shops = ['A', 'B'].map((label, i) => ({
  label,
  businessId: randomUUID(),
  userId: randomUUID(),
  phone: `${i ? 8 : 9}${Date.now().toString().slice(-9)}`,
  password: `Qa${tag}!scan${label}`,
}));
const [A, B] = shops;
const KNOWN = ean13(`20${digits}01`);
const UNKNOWN = ean13(`20${digits}02`);
const RETRY = ean13(`20${digits}03`);
const DRAFT = ean13(`20${digits}04`);
const KNOWN_NAME = `Known item ${tag}`;

let server;
let client;

async function purge() {
  if (!client) return;
  const ids = shops.map((s) => s.businessId);
  await client.query('BEGIN');
  try {
    await client.query(
      `SELECT set_config('khatario.ledger_delete_reason', 'tenant_purge', true),
              set_config('khatario.actor_id', '', true)`
    );
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
      DB_PORT: port,
      DB_SSL: 'false',
      E2E_DISABLE_RATE_LIMIT: 'true',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const logStream = fs.createWriteStream(path.resolve(process.cwd(), 'tests/live/scan-add-e2e-server.log'), { flags: 'w' });
  server.stdout.pipe(logStream);
  server.stderr.pipe(logStream);
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const wait = async () => {
      while (Date.now() - started < 180000) {
        if (server.exitCode != null) return reject(new Error('Next.js exited before it was ready'));
        try {
          if ((await fetch(`${BASE}/api/auth/login`)).status === 200) return resolve();
        } catch {
          /* still booting */
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
      reject(new Error('Next.js did not become ready'));
    };
    wait().catch(reject);
  });
}

function stopServer() {
  if (!server || server.killed) return;
  if (process.platform === 'win32') spawn('taskkill', ['/PID', String(server.pid), '/T', '/F'], { stdio: 'ignore' });
  else server.kill('SIGTERM');
}

async function seed() {
  const plan = await client.query(
    `SELECT p.plan_id FROM subscription_plan_features p
      JOIN subscription_plan_features q ON q.plan_id = p.plan_id AND q.feature_id = 'items_scan_onboarding' AND q.enabled
     WHERE p.feature_id = 'purchase_inventory_adjustments' AND p.enabled
     ORDER BY p.plan_id LIMIT 1`
  );
  if (!plan.rows[0]) throw new Error('No plan has both items_scan_onboarding and inventory adjustments');
  for (const s of shops) {
    await client.query(
      `INSERT INTO businesses (id, name, state_code, gst_registration_type, primary_module) VALUES ($1, $2, '27', 'regular', 'billing')`,
      [s.businessId, `SCAN-E2E ${s.label} ${tag}`]
    );
    await client.query(`INSERT INTO business_modules (business_id, module_key, enabled, source) VALUES ($1, 'billing', true, 'test')`, [s.businessId]);
    await client.query(
      `INSERT INTO business_module_subscriptions (business_id, module_key, plan_id, status, start_date, end_date)
       VALUES ($1, 'billing', $2, 'active', CURRENT_DATE, CURRENT_DATE + 30)`,
      [s.businessId, plan.rows[0].plan_id]
    );
    await client.query(`SELECT create_default_chart_of_accounts($1)`, [s.businessId]);
    await client.query(`INSERT INTO branches (id, business_id, name, state_code, is_default, is_active) VALUES ($1, $2, 'Main', '27', true, true)`, [
      randomUUID(),
      s.businessId,
    ]);
    await client.query(
      `INSERT INTO users (id, business_id, name, phone, password_hash, is_primary_admin, auth_session_version, is_active, product_tour_completed_at)
       VALUES ($1, $2, $3, $4, $5, true, 1, true, NOW())`,
      [s.userId, s.businessId, `Scan E2E ${s.label} ${tag}`, s.phone, bcrypt.hashSync(s.password, 8)]
    );
  }
  await client.query(
    `INSERT INTO items (business_id, name, barcode, barcode_type, unit, item_type, selling_price, purchase_price, opening_stock, current_stock)
     VALUES ($1, $2, $3, 'EAN13', 'PCS', 'goods', 10, 8, 0, 0)`,
    [A.businessId, KNOWN_NAME, KNOWN]
  );
}

/** What the spec created, read straight from the database. */
async function checkRows() {
  const rows = (
    await client.query(
      `SELECT i.name, i.business_id = $2 AS in_a, i.current_stock::numeric AS stock,
              (SELECT COUNT(*)::int FROM items x WHERE x.business_id = i.business_id AND x.name = i.name AND x.deleted_at IS NULL) AS copies,
              (SELECT COUNT(*)::int FROM stock_movements m WHERE m.item_id = i.id) AS movements,
              (SELECT COALESCE(SUM(l.debit), 0)::numeric FROM ledger_entry_lines l
                WHERE l.business_id = i.business_id AND l.voucher_id = i.id AND l.voucher_type = 'opening_stock') AS opening_value,
              i.external_source->>'provider' AS source
         FROM items i
        WHERE i.business_id = ANY($1::uuid[]) AND i.name LIKE $3`,
      [shops.map((s) => s.businessId), A.businessId, `%${tag}`]
    )
  ).rows;
  const expect = {
    [`Manual item ${tag}`]: { stock: 7, value: 84, source: null },
    [`Harpic 500 ml ${tag}`]: { stock: 3, value: 240, source: 'productguru' },
    [`Retry item ${tag}`]: { stock: 5, value: 45, source: null },
    [`Review item ${tag}`]: { stock: 2, value: 20, source: null },
  };
  let failures = 0;
  for (const [name, want] of Object.entries(expect)) {
    const r = rows.find((x) => x.name === name);
    const ok =
      r && r.in_a && r.copies === 1 && r.movements === 1 && Number(r.stock) === want.stock && Number(r.opening_value) === want.value && r.source === want.source;
    console.log(
      `${ok ? 'PASS' : 'FAIL'} ${name.replace(` ${tag}`, '')}: ${
        r ? `copies ${r.copies}, stock movements ${r.movements}, stock ${Number(r.stock)}, opening value ${Number(r.opening_value)}, source ${r.source}` : 'missing'
      }`
    );
    if (!ok) failures++;
  }
  const leaked = rows.filter((r) => !r.in_a).length;
  console.log(`${leaked === 0 ? 'PASS' : 'FAIL'} items created in business B: ${leaked}`);
  const drafts = rows.filter((r) => /^(Draft item|A only) /.test(r.name)).length;
  console.log(`${drafts === 0 ? 'PASS' : 'FAIL'} unsaved drafts reached the server: ${drafts}`);
  return failures + leaked + drafts;
}

async function main() {
  client = new Client({ connectionString: databaseUrl });
  await client.connect();
  const info = (await client.query(`SELECT current_database() AS db, inet_server_addr()::text AS addr, inet_server_port() AS port`)).rows[0];
  if (info.db !== 'kh_phase2_test' || Number(info.port) !== 5433 || (!String(info.addr).includes('127.0.0.1') && !String(info.addr).includes('::1'))) {
    throw new Error(`Refusing browser run against ${info.db} at ${info.addr}:${info.port}`);
  }
  console.log(`database ${info.db} loopback port ${info.port}`);
  await seed();
  await startServer();
  console.log(`next dev listening on 127.0.0.1:${PORT}`);
  for (const p of ['/login', '/items', '/items/scan-add', '/items/new', '/api/auth/session']) {
    await fetch(`${BASE}${p}`).catch(() => null);
  }

  const exitCode = await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['node_modules/playwright/cli.js', 'test', process.env.SCAN_E2E_SPEC || 'e2e/scan-add-items.spec.ts', '--project=chromium', '--retries=0', '--reporter=list'],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          PLAYWRIGHT_BASE_URL: BASE,
          PLAYWRIGHT_SKIP_WEBSERVER: '1',
          E2E_TEST_PHONE: A.phone,
          E2E_TEST_PASSWORD: A.password,
          SCAN_E2E_PHONE_B: B.phone,
          SCAN_E2E_PASSWORD_B: B.password,
          SCAN_E2E_KNOWN_BARCODE: KNOWN,
          SCAN_E2E_KNOWN_NAME: KNOWN_NAME,
          SCAN_E2E_UNKNOWN_BARCODE: UNKNOWN,
          SCAN_E2E_RETRY_BARCODE: RETRY,
          SCAN_E2E_DRAFT_BARCODE: DRAFT,
          SCAN_E2E_TAG: tag,
        },
        stdio: 'inherit',
      }
    );
    child.on('exit', (code) => resolve(code ?? 1));
    child.on('error', reject);
  });
  console.log(`playwright exit ${exitCode}`);
  const failures = await checkRows();
  console.log(`database checks ${failures === 0 ? 'passed' : `failed ${failures}`}`);
  if (exitCode !== 0 || failures) process.exitCode = 1;
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
        const left = await client.query(`SELECT COUNT(*)::int AS n FROM businesses WHERE name LIKE 'SCAN-E2E %'`);
        console.log(`leftover SCAN-E2E businesses ${left.rows[0].n}`);
        await client.end();
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : 'cleanup failed');
      process.exitCode = 1;
    }
  });
