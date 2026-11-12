/**
 * business_integrations: migration 476 copies the old Shiprocket columns once, and running it again changes nothing.
 * Runs only when PHASE2_TEST_DATABASE_URL points at a disposable database.
 */
import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import path from 'path';
import type { Pool } from 'pg';

const url = process.env.PHASE2_TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
const d = url ? describe : describe.skip;

import { getPool, closePool } from '@/lib/db';
import { hashStoreWebhookToken } from '@/lib/store/delivery/webhooks';

/** The copy statement from the migration, so the test runs exactly what ships. */
const COPY_SQL = (() => {
  const sql = readFileSync(path.join(process.cwd(), 'database/migrations/476_business_integrations.sql'), 'utf8');
  const m = sql.match(/INSERT INTO business_integrations[\s\S]*?;/);
  if (!m) throw new Error('INSERT statement not found in migration 476');
  return m[0];
})();

d('business_integrations (real DB)', () => {
  jest.setTimeout(60000);

  let pool: Pool;
  const A = randomUUID();
  const B = randomUUID();
  const C = randomUUID();
  const D = randomUUID();
  const ALL = [A, B, C, D];
  const tag = A.slice(0, 8);
  const HASH_A = hashStoreWebhookToken(`bint${tag}${'a'.repeat(24)}`);

  beforeAll(async () => {
    pool = getPool();
    const db = await pool.query<{ db: string }>('SELECT current_database() AS db');
    if (!/test/i.test(db.rows[0].db)) throw new Error(`Refusing to run against ${db.rows[0].db}`);
    for (const [biz, name] of [
      [A, 'A'],
      [B, 'B'],
      [C, 'C'],
      [D, 'D'],
    ] as const) {
      await pool.query(
        `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type)
         VALUES ($1, $2, '27AAAPA1234A1Z5', '27', 'regular')`,
        [biz, `Integ ${name} ${tag}`],
      );
      await pool.query(`INSERT INTO business_settings (business_id) VALUES ($1) ON CONFLICT (business_id) DO NOTHING`, [biz]);
    }
  });

  afterAll(async () => {
    if (!pool) return;
    try {
      await pool.query(`DELETE FROM business_integrations WHERE business_id = ANY($1::uuid[])`, [ALL]);
      await pool.query(`DELETE FROM businesses WHERE id = ANY($1::uuid[])`, [ALL]);
    } finally {
      await closePool();
    }
  });

  test('copy: old Shiprocket columns become one connection, and running it twice changes nothing', async () => {
    await pool.query(
      `INSERT INTO business_settings (business_id, store_shiprocket_email, store_shiprocket_password_enc, store_shiprocket_webhook_token_hash)
       VALUES ($1, 'api@shop.test', 'CIPHERTEXT', $2)
       ON CONFLICT (business_id) DO UPDATE SET store_shiprocket_email = EXCLUDED.store_shiprocket_email,
         store_shiprocket_password_enc = EXCLUDED.store_shiprocket_password_enc,
         store_shiprocket_webhook_token_hash = EXCLUDED.store_shiprocket_webhook_token_hash`,
      [A, HASH_A],
    );
    await pool.query(COPY_SQL);
    await pool.query(COPY_SQL);
    const { rows } = await pool.query(
      `SELECT config, secrets_enc, webhook_token_hash FROM business_integrations WHERE business_id = $1 AND provider = 'shiprocket'`,
      [A],
    );
    expect(rows).toEqual([{ config: { email: 'api@shop.test' }, secrets_enc: { password: 'CIPHERTEXT' }, webhook_token_hash: HASH_A }]);
  });

  test('copy: a business with no Shiprocket columns gets no row', async () => {
    // B has a business_settings row with all three columns NULL
    expect((await pool.query(`SELECT 1 FROM business_integrations WHERE business_id = $1`, [B])).rowCount).toBe(0);
  });
});
