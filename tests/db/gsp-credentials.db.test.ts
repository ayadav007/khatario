/**
 * Masters India login stored through the integrations service and read back by loadGspCredentials.
 * Runs only when PHASE2_TEST_DATABASE_URL points at a disposable database.
 */
import { randomUUID } from 'crypto';
import type { Pool } from 'pg';

const url = process.env.PHASE2_TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
if (!process.env.PAYMENT_ENCRYPTION_KEY) process.env.PAYMENT_ENCRYPTION_KEY = '0123456789abcdef'.repeat(4);
const d = url ? describe : describe.skip;

import { getPool, closePool } from '@/lib/db';
import { disconnect, saveConnection } from '@/lib/integrations/service';
import { loadGspCredentials } from '@/lib/gsp/mastersindia/credentials';

d('GSP credentials (real DB)', () => {
  jest.setTimeout(60000);

  let pool: Pool;
  const businessId = randomUUID();

  beforeAll(async () => {
    pool = getPool();
    const db = await pool.query<{ db: string }>('SELECT current_database() AS db');
    if (!/test/i.test(db.rows[0].db)) throw new Error(`Refusing to run against ${db.rows[0].db}`);
    await pool.query(
      `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type)
       VALUES ($1, $2, '27AAAPA1234A1Z5', '27', 'regular')`,
      [businessId, `Gsp ${businessId.slice(0, 8)}`],
    );
    await pool.query(`INSERT INTO business_settings (business_id) VALUES ($1) ON CONFLICT (business_id) DO NOTHING`, [businessId]);
  });

  afterAll(async () => {
    if (!pool) return;
    try {
      await pool.query(`DELETE FROM business_integrations WHERE business_id = $1`, [businessId]);
      await pool.query(`DELETE FROM businesses WHERE id = $1`, [businessId]);
    } finally {
      await closePool();
    }
  });

  it('returns null until connected, then the stored login, and null again after disconnect', async () => {
    expect(await loadGspCredentials(businessId)).toBeNull();
    const saved = await saveConnection(businessId, 'gst-masters-india', { username: ' u@x.co ', password: 'S3cret' }, null, { verify: async () => ({ ok: true }) });
    expect(saved.ok).toBe(true);
    expect(await loadGspCredentials(businessId)).toEqual({ username: 'u@x.co', password: 'S3cret' });
    const row = await getPool().query(`SELECT secrets_enc::text AS s FROM business_integrations WHERE business_id = $1 AND provider = 'mastersindia'`, [businessId]);
    expect(row.rows[0].s).not.toContain('S3cret');
    await disconnect(businessId, 'mastersindia');
    expect(await loadGspCredentials(businessId)).toBeNull();
  });
});
