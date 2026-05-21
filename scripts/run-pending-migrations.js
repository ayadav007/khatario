/**
 * Run pending SQL migrations from database/migrations in order.
 *
 * Usage:
 *   node scripts/run-pending-migrations.js              # run not-yet-applied migrations
 *   node scripts/run-pending-migrations.js --dry-run      # list pending only
 *   node scripts/run-pending-migrations.js --from 239     # run 239+ only (recommended on VPS)
 *   node scripts/run-pending-migrations.js --mark-below 239  # mark older as applied (existing DB bootstrap)
 *   node scripts/run-pending-migrations.js --stop-on-error
 *
 * Loads .env, .env.production, .env.local (same as run-migration.js).
 */

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

function loadEnvFiles() {
  const root = path.join(__dirname, '..');
  for (const file of ['.env', '.env.production', '.env.local']) {
    require('dotenv').config({ path: path.join(root, file) });
  }
}

function getDbConfig() {
  if (process.env.DATABASE_URL) {
    return { connectionString: process.env.DATABASE_URL };
  }

  return {
    host: process.env.DB_HOST || process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || process.env.POSTGRES_PORT || '5432', 10),
    database:
      process.env.DB_NAME ||
      process.env.POSTGRES_DB ||
      process.env.POSTGRES_DATABASE ||
      'khatario',
    user: process.env.DB_USER || process.env.POSTGRES_USER || 'postgres',
    password: String(process.env.DB_PASSWORD ?? process.env.POSTGRES_PASSWORD ?? ''),
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  };
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
  const args = { dryRun: false, stopOnError: false, from: null, markBelow: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--stop-on-error') args.stopOnError = true;
    else if (arg.startsWith('--from=')) args.from = parseInt(arg.split('=')[1], 10);
    else if (arg === '--from') args.from = parseInt(argv[i + 1], 10);
    else if (arg.startsWith('--mark-below=')) args.markBelow = parseInt(arg.split('=')[1], 10);
    else if (arg === '--mark-below') args.markBelow = parseInt(argv[i + 1], 10);
  }
  return args;
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

  const baseline = parseInt(process.env.MIGRATION_BASELINE || '239', 10);
  if (Number.isNaN(baseline)) return;

  const toMark = allFiles.filter((f) => {
    const match = f.match(/^(\d+)_/);
    return match && parseInt(match[1], 10) < baseline;
  });

  console.log(
    `Existing database (schema_migrations empty). Auto-marking ${toMark.length} migrations below ${baseline}...`
  );
  console.log(`(Set MIGRATION_BASELINE in .env.production to change this one-time bootstrap.)\n`);

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
    if (dbConfig.connectionString) {
      console.log('Using DATABASE_URL');
    } else {
      console.log(`Host: ${dbConfig.host}, DB: ${dbConfig.database}, User: ${dbConfig.user}`);
    }

    await ensureLogTable(client);

    await maybeAutoBootstrapExistingDb(client, allFiles);

    if (args.markBelow != null && !Number.isNaN(args.markBelow)) {
      const toMark = allFiles.filter((f) => {
        const match = f.match(/^(\d+)_/);
        return match && parseInt(match[1], 10) < args.markBelow;
      });
      console.log(`Marking ${toMark.length} migrations below ${args.markBelow} as already applied...`);
      for (const file of toMark) {
        await client.query(
          `INSERT INTO schema_migrations (migration_name, success, error_message)
           VALUES ($1, true, 'bootstrap: marked below threshold')
           ON CONFLICT (migration_name) DO NOTHING`,
          [file]
        );
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

    for (const file of pending) {
      const filePath = path.join(__dirname, '..', 'database', 'migrations', file);
      const sql = fs.readFileSync(filePath, 'utf8');

      if (sql.includes('\\i ')) {
        console.log(`⏭️  Skip ${file} (uses psql \\i — run manually with psql if needed)`);
        await client.query(
          `INSERT INTO schema_migrations (migration_name, success, error_message)
           VALUES ($1, true, 'skipped: psql meta file')
           ON CONFLICT (migration_name) DO UPDATE SET success = true, executed_at = NOW()`,
          [file]
        );
        skipped++;
        continue;
      }

      process.stdout.write(`📝 ${file} ... `);
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('COMMIT');

        await client.query(
          `INSERT INTO schema_migrations (migration_name, success, error_message)
           VALUES ($1, true, NULL)
           ON CONFLICT (migration_name) DO UPDATE SET success = true, executed_at = NOW(), error_message = NULL`,
          [file]
        );
        console.log('✅');
        ok++;
      } catch (error) {
        await client.query('ROLLBACK');

        if (isIdempotentError(error.message)) {
          await client.query(
            `INSERT INTO schema_migrations (migration_name, success, error_message)
             VALUES ($1, true, $2)
             ON CONFLICT (migration_name) DO UPDATE SET success = true, executed_at = NOW(), error_message = $2`,
            [file, `idempotent: ${error.message.split('\n')[0]}`]
          );
          console.log(`⏭️  already applied (${error.message.split('\n')[0]})`);
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

    console.log('\n' + '='.repeat(60));
    console.log(`✅ Applied: ${ok}`);
    console.log(`⏭️  Skipped/idempotent: ${skipped}`);
    console.log(`❌ Failed: ${failed}`);
    console.log('='.repeat(60));
    console.log('\nCheck status anytime:');
    console.log('  SELECT migration_name, success, executed_at FROM schema_migrations ORDER BY executed_at DESC LIMIT 20;');

    if (failed > 0) process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
