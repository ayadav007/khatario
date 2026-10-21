/**
 * Sequential security regressions already verified in Phases 3A–3O and the
 * chart-of-accounts report HTTP check. Does not change application code.
 * Prints suite names and the child output. Does not print cookies, passwords,
 * or the database URL.
 */
import fs from 'fs';
import net from 'net';
import path from 'path';
import { spawn } from 'child_process';
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
const databaseUrl = `postgresql://${encodeURIComponent(envFile.DB_USER)}:${encodeURIComponent(envFile.DB_PASSWORD)}@${host}:${envFile.DB_PORT || '5432'}/kh_phase2_test`;

const jestBin = path.resolve('node_modules/jest/bin/jest.js');
const prefixes = ['P3A %', 'P3C %', 'P3E %', 'P3G %', 'P3I %', 'P3K %', 'P3M %', 'P3N %', 'P3O %', 'COA-RPT %'];

const suites = [
  {
    name: 'Phase 3A middleware identity headers',
    args: [jestBin, 'tests/security/middleware-identity-headers.test.ts', '--runInBand', '--forceExit', '--watchman=false'],
  },
  {
    name: 'Phase 3A cron authorization',
    args: [jestBin, 'tests/security/cron-auth.test.ts', '--runInBand', '--forceExit', '--watchman=false'],
  },
  {
    name: 'Phase 3A–3L database identity regressions',
    args: [
      jestBin,
      'tests/db/phase3a-auth-isolation.db.test.ts',
      'tests/db/phase3c-identity-fallback.db.test.ts',
      'tests/db/phase3e-identity-fallback.db.test.ts',
      'tests/db/phase3g-write-identity.db.test.ts',
      'tests/db/phase3i-write-identity.db.test.ts',
      'tests/db/phase3k-write-identity.db.test.ts',
      '--runInBand',
      '--forceExit',
      '--watchman=false',
    ],
  },
  { name: 'Phase 3M live HTTP', args: ['tests/live/phase3m-http.mjs'], port: 3108 },
  { name: 'Phase 3N live HTTP', args: ['tests/live/phase3n-http.mjs'], port: 3109 },
  { name: 'Phase 3O live HTTP', args: ['tests/live/phase3o-http.mjs'], port: 3110 },
  { name: 'Chart of accounts report live HTTP', args: ['tests/live/coa-reports-http.mjs'], port: 3121 },
];

function portOpen(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    const done = (open) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(open);
    };
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

async function waitForPort(port, open, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if ((await portOpen(port)) === open) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

function runSuite(suite) {
  console.log(`\n=== ${suite.name} ===`);
  return new Promise((resolve) => {
    const child = spawn(process.execPath, suite.args, {
      cwd: process.cwd(),
      stdio: 'inherit',
      env: process.env,
    });
    child.on('exit', (code) => resolve(code == null ? 1 : code));
  });
}

async function assertDb() {
  const pool = new pg.Pool({ connectionString: databaseUrl });
  try {
    const db = await pool.query(`SELECT current_database() AS db, inet_server_addr()::text AS addr, inet_server_port() AS port`);
    const info = db.rows[0];
    if (info.db !== 'kh_phase2_test' || Number(info.port) !== 5433 || (!String(info.addr).includes('127.0.0.1') && !String(info.addr).includes('::1'))) {
      throw new Error(`Refusing security regressions against ${info.db} at ${info.addr}:${info.port}`);
    }
    console.log(`database ${info.db} loopback port ${info.port}`);
  } finally {
    await pool.end();
  }
}

async function leftoverCounts() {
  const pool = new pg.Pool({ connectionString: databaseUrl });
  try {
    const counts = [];
    for (const prefix of prefixes) {
      const row = await pool.query(`SELECT COUNT(*)::int AS n FROM businesses WHERE name LIKE $1`, [prefix]);
      counts.push(`${prefix.replace(' %', '')}=${row.rows[0].n}`);
    }
    return counts.join(' ');
  } finally {
    await pool.end();
  }
}

async function main() {
  await assertDb();
  for (const suite of suites) {
    if (suite.port && await portOpen(suite.port)) {
      console.error(`BLOCKED ${suite.name} port ${suite.port} is already in use`);
      process.exitCode = 1;
      return;
    }
  }

  for (const suite of suites) {
    const code = await runSuite(suite);
    if (suite.port) {
      const free = await waitForPort(suite.port, false, 20000);
      if (!free) {
        console.error(`BLOCKED ${suite.name} left port ${suite.port} open`);
        process.exitCode = code === 0 ? 1 : code;
        return;
      }
    }
    console.log(`--- ${suite.name} exit ${code} ---`);
    if (code !== 0) {
      process.exitCode = code;
      return;
    }
  }

  const leftovers = await leftoverCounts();
  console.log(`fixture businesses left ${leftovers}`);
  if (leftovers.split(' ').some((item) => !item.endsWith('=0'))) {
    console.error('BLOCKED fixture businesses were left behind');
    process.exitCode = 1;
    return;
  }
  console.log('SECURITY REGRESSION PASS');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'security regression runner failed');
  process.exitCode = 1;
});
