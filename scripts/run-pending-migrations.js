/**
 * Run pending SQL migrations from database/migrations in order.
 *
 * Usage:
 *   node scripts/run-pending-migrations.js              # run not-yet-applied migrations
 *   node scripts/run-pending-migrations.js --dry-run      # list pending only
 *   node scripts/run-pending-migrations.js --from 239     # run 239+ only (recommended on VPS)
 *   node scripts/run-pending-migrations.js --mark-below 239  # mark older as applied (existing DB bootstrap)
 *   node scripts/run-pending-migrations.js --stop-on-error
 *   node scripts/run-pending-migrations.js --accept-already-exists  # legacy bootstrap only: record
 *       "already exists" failures as accepted (labelled NOT executed) instead of failed
 *
 * A file is recorded as successful only when it committed; the success row is
 * written inside the file's own transaction.
 *
 * Loads .env, .env.production, .env.local (same as run-migration.js).
 */

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { loadEnvFiles, getMigrationDbConfig, describeMigrationDb, isLikelyAppOnlyDbUser } = require('./db-config');

function getDbConfig() {
  return getMigrationDbConfig();
}

const SKIP_FILES = new Set(['000_run_all_gst_migrations.sql']);

function migrationSortKey(filename) {
  const match = filename.match(/^(\d+)_/);
  if (match) {
    return [parseInt(match[1], 10), filename];
  }
  return [999999, filename];
}

function listMigrationFiles() {
  const dir = path.join(__dirname, '..', 'database', 'migrations');
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.sql') && !SKIP_FILES.has(f))
    .sort((a, b) => {
      const [na, fa] = migrationSortKey(a);
      const [nb, fb] = migrationSortKey(b);
      if (na !== nb) return na - nb;
      return fa.localeCompare(fb);
    });
}

function parseArgs(argv) {
  const args = { dryRun: false, stopOnError: false, from: null, markBelow: null, acceptExisting: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--stop-on-error') args.stopOnError = true;
    else if (arg === '--accept-already-exists') args.acceptExisting = true;
    else if (arg.startsWith('--from=')) args.from = parseInt(arg.split('=')[1], 10);
    else if (arg === '--from') args.from = parseInt(argv[i + 1], 10);
    else if (arg.startsWith('--mark-below=')) args.markBelow = parseInt(arg.split('=')[1], 10);
    else if (arg === '--mark-below') args.markBelow = parseInt(argv[i + 1], 10);
  }
  return args;
}

/**
 * Strip one outer BEGIN;/COMMIT; pair (optionally preceded/followed by comment
 * lines) so the runner's own transaction wraps the file. Returns null when a
 * transaction-control statement remains at statement level, because running it
 * would commit part of the file outside the runner's transaction.
 */
function unwrapExplicitTransaction(sql) {
  let s = String(sql || '');
  s = s.replace(/^((?:\s*--[^\n]*\n)*)\s*BEGIN\s*;/i, '$1');
  s = s.replace(/COMMIT\s*;((?:\s*--[^\n]*)*)\s*$/i, '$1');
  if (/^\s*(BEGIN|COMMIT|ROLLBACK)\s*;/im.test(s.replace(/\$([A-Za-z_]*)\$[\s\S]*?\$\1\$/g, ''))) {
    return null;
  }
  return s.trim();
}

function splitSqlStatements(sql) {
  const withoutComments = String(sql || '').replace(/--[^\n]*/g, '');
  return withoutComments
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function isIdempotentError(message) {
  const m = String(message || '').toLowerCase();
  return (
    m.includes('already exists') ||
    m.includes('duplicate key') ||
    m.includes('duplicate object') ||
    m.includes('does not exist, skipping') ||
    m.includes('if not exists')
  );
}

async function ensureLogTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id SERIAL PRIMARY KEY,
      migration_name VARCHAR(255) UNIQUE NOT NULL,
      executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      success BOOLEAN NOT NULL DEFAULT true,
      error_message TEXT
    )
  `);
}

async function getAppliedMigrations(client) {
  const { rows } = await client.query(`
    SELECT migration_name, success, executed_at, error_message
    FROM schema_migrations
    ORDER BY executed_at
  `);
  return rows;
}

/** First deploy on an existing DB: mark old migrations as applied without running them. */
async function maybeAutoBootstrapExistingDb(client, allFiles) {
  const { rows } = await client.query(`SELECT COUNT(*)::int AS n FROM schema_migrations`);
  if (rows[0].n > 0) return;

  const { rows: tableRows } = await client.query(
    `SELECT to_regclass('public.businesses') IS NOT NULL AS has_businesses`
  );
  if (!tableRows[0]?.has_businesses) {
    console.log('Fresh database detected — will run all migrations from the start.\n');
    return;
  }

  if (!process.env.MIGRATION_BASELINE) {
    console.log(
      'Existing database with empty schema_migrations and no MIGRATION_BASELINE set — nothing auto-marked; all migrations will run (they are expected to be idempotent).\n'
    );
    return;
  }
  const baseline = parseInt(process.env.MIGRATION_BASELINE, 10);
  if (Number.isNaN(baseline)) return;

  const candidates = allFiles.filter((f) => {
    const match = f.match(/^(\d+)_/);
    return match && parseInt(match[1], 10) < baseline;
  });

  // Only mark a file as applied when every table it creates already exists.
  const toMark = [];
  const skipped = [];
  for (const file of candidates) {
    const sql = fs.readFileSync(path.join(__dirname, '..', 'database', 'migrations', file), 'utf8');
    const tables = [...sql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?"?([a-zA-Z_][a-zA-Z0-9_]*)"?/gi)].map(
      (m) => m[1].toLowerCase()
    );
    let missing = null;
    for (const t of tables) {
      const { rows: r } = await client.query(`SELECT to_regclass($1) IS NOT NULL AS ok`, [`public.${t}`]);
      if (!r[0]?.ok) {
        missing = t;
        break;
      }
    }
    if (missing) skipped.push(`${file} (missing table ${missing})`);
    else toMark.push(file);
  }

  console.log(
    `Existing database (schema_migrations empty). Auto-marking ${toMark.length} migrations below ${baseline}...`
  );
  if (skipped.length) {
    console.log(`Not marked (will run because their tables are missing):\n  ${skipped.join('\n  ')}`);
  }
  console.log(`(MIGRATION_BASELINE controls this one-time bootstrap.)\n`);

  for (const file of toMark) {
    await client.query(
      `INSERT INTO schema_migrations (migration_name, success, error_message)
       VALUES ($1, true, 'auto-bootstrap: existing database')
       ON CONFLICT (migration_name) DO NOTHING`,
      [file]
    );
  }
}

async function main() {
  loadEnvFiles();
  const args = parseArgs(process.argv.slice(2));
  const dbConfig = getDbConfig();

  if (!dbConfig.connectionString && !dbConfig.database) {
    console.error('❌ Database configuration missing.');
    console.error('   Set DATABASE_URL or DB_* in .env / .env.production');
    process.exit(1);
  }

  const allFiles = listMigrationFiles();
  const files =
    args.from != null && !Number.isNaN(args.from)
      ? allFiles.filter((f) => {
          const match = f.match(/^(\d+)_/);
          return match && parseInt(match[1], 10) >= args.from;
        })
      : allFiles;

  const pool = new Pool(dbConfig);
  const client = await pool.connect();

  try {
    console.log('Connecting to database...');
    console.log(`Migration DB: ${describeMigrationDb(dbConfig)}`);

    // Serialise runners (deploy hook + manual run) so a file is never applied twice concurrently.
    const lock = await client.query(`SELECT pg_try_advisory_lock(hashtext('khatario_schema_migrations')) AS ok`);
    if (!lock.rows[0]?.ok) {
      console.error('Another migration run holds the lock; aborting.');
      process.exitCode = 1;
      return;
    }

    await ensureLogTable(client);

    await maybeAutoBootstrapExistingDb(client, allFiles);

    if (args.markBelow != null && !Number.isNaN(args.markBelow)) {
      const toMark = allFiles.filter((f) => {
        const match = f.match(/^(\d+)_/);
        return match && parseInt(match[1], 10) < args.markBelow;
      });
      console.log(`Marking ${toMark.length} migrations below ${args.markBelow} as already applied...`);
      const keptFailures = [];
      for (const file of toMark) {
        // Never flip a recorded failure to success; it must be fixed and re-run.
        const res = await client.query(
          `INSERT INTO schema_migrations (migration_name, success, error_message)
           VALUES ($1, true, 'bootstrap: marked below threshold')
           ON CONFLICT (migration_name) DO NOTHING
           RETURNING id`,
          [file]
        );
        if (res.rowCount === 0) {
          const prev = await client.query(
            `SELECT success FROM schema_migrations WHERE migration_name = $1`,
            [file]
          );
          if (prev.rows[0] && prev.rows[0].success === false) keptFailures.push(file);
        }
      }
      if (keptFailures.length) {
        console.log(`Left as FAILED (not overwritten):\n  ${keptFailures.join('\n  ')}`);
      }
      console.log('Bootstrap complete.\n');
    }

    const applied = await getAppliedMigrations(client);
    const appliedSuccess = new Set(
      applied.filter((r) => r.success).map((r) => r.migration_name)
    );

    const pending = files.filter((f) => !appliedSuccess.has(f));

    console.log(`\nTotal migration files: ${allFiles.length}`);
    if (args.from != null) console.log(`Filter: from ${args.from} → ${files.length} files`);
    console.log(`Already applied (success): ${appliedSuccess.size}`);
    console.log(`Pending: ${pending.length}\n`);

    if (pending.length === 0) {
      console.log('✅ No pending migrations.');
      return;
    }

    if (args.dryRun) {
      console.log('Pending migrations (--dry-run):');
      pending.forEach((f) => console.log(`  - ${f}`));
      return;
    }

    let ok = 0;
    let skipped = 0;
    let failed = 0;

    const recordSuccessSql = `INSERT INTO schema_migrations (migration_name, success, error_message)
           VALUES ($1, true, NULL)
           ON CONFLICT (migration_name) DO UPDATE SET success = true, executed_at = NOW(), error_message = NULL`;

    for (const file of pending) {
      const filePath = path.join(__dirname, '..', 'database', 'migrations', file);
      const sql = fs.readFileSync(filePath, 'utf8');

      if (sql.includes('\\i ')) {
        // Not executed, so never recorded as applied.
        console.log(`⏭️  Skip ${file} (uses psql \\i — run manually with psql; NOT marked applied)`);
        skipped++;
        continue;
      }

      process.stdout.write(`📝 ${file} ... `);
      const needsAutocommit = /CREATE\s+(UNIQUE\s+)?INDEX\s+CONCURRENTLY/i.test(sql);
      const sqlToRun = needsAutocommit ? String(sql) : unwrapExplicitTransaction(sql);
      try {
        if (sqlToRun == null) {
          throw new Error(
            'File contains a statement-level BEGIN/COMMIT/ROLLBACK beyond one outer pair; refusing to run it partially outside a transaction'
          );
        }
        if (needsAutocommit) {
          for (const stmt of splitSqlStatements(sqlToRun)) {
            await client.query(stmt);
          }
          await client.query(recordSuccessSql, [file]);
        } else {
          await client.query('BEGIN');
          await client.query(sqlToRun);
          // Recorded inside the same transaction: the row exists iff the file committed.
          await client.query(recordSuccessSql, [file]);
          await client.query('COMMIT');
        }
        console.log('✅');
        ok++;
      } catch (error) {
        if (!needsAutocommit) {
          try {
            await client.query('ROLLBACK');
          } catch {
            /* ignore */
          }
        }

        // Legacy escape hatch for bootstrapping an old database whose objects
        // pre-date schema_migrations. Nothing in the file was committed, so the
        // row says so explicitly instead of looking like a normal success.
        if (args.acceptExisting && !needsAutocommit && isIdempotentError(error.message)) {
          await client.query(
            `INSERT INTO schema_migrations (migration_name, success, error_message)
             VALUES ($1, true, $2)
             ON CONFLICT (migration_name) DO UPDATE SET success = true, executed_at = NOW(), error_message = $2`,
            [file, `accepted-existing (NOT executed, --accept-already-exists): ${error.message.split('\n')[0]}`]
          );
          console.log(`⚠️  accepted as existing, NOT executed (${error.message.split('\n')[0]})`);
          skipped++;
          continue;
        }

        await client.query(
          `INSERT INTO schema_migrations (migration_name, success, error_message)
           VALUES ($1, false, $2)
           ON CONFLICT (migration_name) DO UPDATE SET success = false, executed_at = NOW(), error_message = $2`,
          [file, error.message]
        );
        console.log(`❌ ${error.message.split('\n')[0]}`);
        failed++;

        if (args.stopOnError) {
          console.error('\nStopped due to --stop-on-error');
          process.exit(1);
        }
      }
    }

    // Migrations often run as postgres; app connects as khatario_user.
    // Re-grant so newly created tables are usable without a manual script.
    if (ok > 0) {
      try {
        await client.query(`
          DO $$
          BEGIN
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'khatario_user') THEN
              GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO khatario_user;
              GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO khatario_user;
              ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO khatario_user;
              ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO khatario_user;
            END IF;
          END $$;
        `);
        console.log('\n🔑 Granted public schema tables/sequences to khatario_user (if role exists)');
      } catch (grantErr) {
        console.warn(
          '\n⚠️  Post-migrate GRANT skipped:',
          grantErr instanceof Error ? grantErr.message : grantErr,
        );
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log(`✅ Applied: ${ok}`);
    console.log(`⏭️  Skipped/idempotent: ${skipped}`);
    console.log(`❌ Failed: ${failed}`);
    console.log('='.repeat(60));
    console.log('\nCheck status anytime:');
    console.log('  SELECT migration_name, success, executed_at FROM schema_migrations ORDER BY executed_at DESC LIMIT 20;');

    if (failed > 0) process.exit(1);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('Fatal:', message);
    if (/permission denied for schema public/i.test(message) && isLikelyAppOnlyDbUser(dbConfig)) {
      console.error('');
      console.error('Your app DB user cannot CREATE tables. Fix one of:');
      console.error('  1) Add to .env.production:');
      console.error('     MIGRATION_DATABASE_URL=postgresql://postgres:PASSWORD@127.0.0.1:5432/khatario');
      console.error('  2) Or grant rights once:');
      console.error('     sudo -u postgres psql -d khatario -f database/scripts/grant-app-user-migrations.sql');
      console.error('');
    }
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Fatal:', err.message);
    process.exit(1);
  });
}

module.exports = { unwrapExplicitTransaction, isIdempotentError, parseArgs };
