// DATABASE_URL=postgres://…/kh_phase2_test node scripts/migrate-store-themes.mjs --all --dry-run
//
// Store theme engine M4 (D33/D34): gives each chosen store its first live engine theme, migrated from
// business_settings.store_theme. Stores that already have a live theme are skipped, so a second run changes nothing.
// It never writes business_settings (store_engine stays as it is) or store_theme.
//
// Options:
//   --all                      every business with a store subdomain
//   --business <uuid>          one business (repeatable); use instead of --all
//   --dry-run                  report what would happen; write nothing
//   --allow-database <name>    run on a database other than kh_phase2_test (the exact name)
//   --report <path>            JSON report path (default tmp-qa/engine-migration/report.json)
//   --preview-links            add a 7-day share preview path for each migrated theme (needs JWT_SECRET)
//
// The connection comes only from DATABASE_URL in this process's environment. The URL is never printed; only the
// database name is.
// Exit codes: 0 all succeeded, 1 any business failed, 2 refused (bad arguments, no DATABASE_URL, wrong database).
import { createRequire } from 'module';
import { mkdirSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_REPORT = 'tmp-qa/engine-migration/report.json';

function refuse(message) {
  console.error(`Refused: ${message}`);
  process.exit(2);
}

function parseArgs(argv) {
  const opts = { all: false, businessIds: [], dryRun: false, allowDatabase: null, report: DEFAULT_REPORT, previewLinks: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) refuse(`${arg} needs a value.`);
      return v;
    };
    switch (arg) {
      case '--all':
        opts.all = true;
        break;
      case '--business':
        opts.businessIds.push(value());
        break;
      case '--dry-run':
        opts.dryRun = true;
        break;
      case '--allow-database':
        opts.allowDatabase = value();
        break;
      case '--report':
        opts.report = value();
        break;
      case '--preview-links':
        opts.previewLinks = true;
        break;
      default:
        refuse(`unknown argument ${JSON.stringify(arg)}.`);
    }
  }
  return opts;
}

const opts = parseArgs(process.argv.slice(2));
if (!process.env.DATABASE_URL) refuse('DATABASE_URL is not set. This script never reads .env files.');
if (opts.all === opts.businessIds.length > 0) refuse('choose exactly one of --all or --business <uuid>.');

// lib/db logs every query text in development; this script prints only its own lines.
if (!process.env.NODE_ENV || process.env.NODE_ENV === 'development') process.env.NODE_ENV = 'production';
process.env.TS_NODE_PROJECT =join(ROOT, 'tsconfig.worker.json');
process.env.TS_NODE_TRANSPILE_ONLY = 'true';
const require = createRequire(import.meta.url);
require('ts-node/register');
require('tsconfig-paths/register');
const { runStoreThemeMigration, MigrationRefusedError } = require(join(ROOT, 'lib/store/engine/migrate-runner.ts'));
const { closePool } = require(join(ROOT, 'lib/db.ts'));

let code = 0;
try {
  const out = await runStoreThemeMigration({
    all: opts.all,
    businessIds: opts.businessIds.length > 0 ? opts.businessIds : undefined,
    dryRun: opts.dryRun,
    allowDatabase: opts.allowDatabase,
    previewLinks: opts.previewLinks,
  });

  const reportPath = resolve(process.cwd(), opts.report);
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify({ generated_at: new Date().toISOString(), ...out }, null, 2)}\n`);

  console.log(`Database: ${out.database}${out.dryRun ? ' (dry run, nothing written)' : ''}`);
  const totals = {};
  for (const row of out.rows) {
    totals[row.status] = (totals[row.status] ?? 0) + 1;
    const n = row.warnings.length;
    const extra = row.error ? `  ${row.error}` : '';
    console.log(`${row.subdomain || row.business_id}  ${row.status}  ${row.preset ?? '-'}  ${n} warning${n === 1 ? '' : 's'}${extra}`);
  }
  const summary = Object.entries(totals).map(([k, v]) => `${k} ${v}`).join(', ');
  console.log(`Total: ${out.rows.length} store${out.rows.length === 1 ? '' : 's'}${summary ? ` (${summary})` : ''}`);
  if (opts.previewLinks && !out.dryRun && !process.env.JWT_SECRET && !process.env.NEXTAUTH_SECRET) {
    console.log('Notice: no preview signing secret is configured, so no preview links were added.');
  }
  console.log(`Report: ${opts.report}`);
  if (out.rows.some((r) => r.status === 'failed')) code = 1;
} catch (err) {
  if (err instanceof MigrationRefusedError) {
    console.error(err.message);
    code = 2;
  } else {
    console.error(`Migration failed: ${err instanceof Error ? err.message : String(err)}`);
    code = 1;
  }
} finally {
  await closePool();
}
process.exit(code);
