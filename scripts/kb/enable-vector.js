/**
 * Enable pgvector for the assistant after installing the OS package
 * (e.g. `sudo apt install postgresql-16-pgvector`). Safe to re-run.
 * Uses MIGRATION_DATABASE_URL when set, because CREATE EXTENSION needs an owner/superuser.
 */
const { Pool } = require('pg');
const { loadEnvFiles, getMigrationDbConfig, describeMigrationDb } = require('../db-config');

async function main() {
  loadEnvFiles();
  const config = getMigrationDbConfig();
  const pool = new Pool(config);
  console.log(`DB: ${describeMigrationDb(config)}`);
  try {
    await pool.query('CREATE EXTENSION IF NOT EXISTS vector');
    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'kb_chunks' AND column_name = 'embedding'
        ) THEN
          ALTER TABLE kb_chunks ADD COLUMN embedding vector(768);
        END IF;
      END $$;
    `);
    await pool.query(
      'CREATE INDEX IF NOT EXISTS idx_kb_chunks_embedding ON kb_chunks USING hnsw (embedding vector_cosine_ops)',
    );
    const { rows } = await pool.query(`SELECT extversion FROM pg_extension WHERE extname = 'vector'`);
    console.log(`pgvector ${rows[0]?.extversion ?? '?'} enabled. Now run: npm run kb:reindex -- --force`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('[kb:enable-vector] failed:', err.message);
  if (/could not open extension control file/i.test(err.message)) {
    console.error('Install the pgvector package for your Postgres version first (see docs/ASSISTANT.md).');
  }
  process.exit(1);
});
