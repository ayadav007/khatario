/**
 * Deploy helper: are any help-doc (markdown) knowledge sources left in an error state?
 * A source that stopped part-way (for example the embedding quota ran out) needs another re-index
 * even when knowledge/ did not change. Plain Node so the deploy does not start ts-node to ask.
 *
 * Exit 0: none in error. Exit 10: some in error (count printed). Exit 1: could not check.
 */
const { Client } = require('pg');
const { loadEnvFiles, getMigrationDbConfig } = require('../db-config');

async function main() {
  loadEnvFiles();
  const client = new Client(getMigrationDbConfig());
  await client.connect();
  try {
    const table = await client.query(`SELECT to_regclass('public.kb_sources') AS t`);
    if (!table.rows[0].t) {
      console.log('kb_sources not found');
      return 0;
    }
    const r = await client.query(`SELECT COUNT(*)::int AS n FROM kb_sources WHERE kind = 'markdown' AND status = 'error'`);
    const n = r.rows[0].n;
    console.log(`markdown sources in error: ${n}`);
    return n > 0 ? 10 : 0;
  } finally {
    await client.end();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(`could not check knowledge sources: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  });
