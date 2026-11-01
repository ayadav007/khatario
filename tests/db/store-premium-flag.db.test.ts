/**
 * The per-store premium themes flag against real PostgreSQL.
 * Runs only when PHASE2_TEST_DATABASE_URL points at a disposable database with migration 459 applied.
 */
import { randomUUID } from 'crypto';
import type { Pool } from 'pg';

const url = process.env.PHASE2_TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
const d = url ? describe : describe.skip;

jest.mock('@/lib/queue/redis', () => ({ getRedisConnection: () => null }));

import { getPool, closePool } from '@/lib/db';
import { PREMIUM_THEMES_FREE, premiumFlagOn, premiumThemesEnabled } from '@/lib/store/engine/premium';

d('Premium themes flag (real DB)', () => {
  jest.setTimeout(60000);

  let pool: Pool;
  const BIZ = randomUUID();

  beforeAll(async () => {
    pool = getPool();
    await pool.query(
      `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type) VALUES ($1, 'Premium flag test', '29AAAPA1234A1Z5', '29', 'regular')`,
      [BIZ],
    );
    await pool.query(`INSERT INTO business_settings (business_id) VALUES ($1) ON CONFLICT (business_id) DO NOTHING`, [BIZ]);
  });

  afterAll(async () => {
    if (!pool) return;
    await pool.query(`DELETE FROM business_settings WHERE business_id = $1`, [BIZ]);
    await pool.query(`DELETE FROM businesses WHERE id = $1`, [BIZ]);
    await closePool();
  });

  it('a fresh settings row has the stored switch off', async () => {
    const { rows } = await pool.query(`SELECT store_premium_themes FROM business_settings WHERE business_id = $1`, [BIZ]);
    expect(rows[0].store_premium_themes).toBe(false);
    expect(await premiumFlagOn(BIZ)).toBe(false);
  });

  it('the stored switch turns on with the column and off again', async () => {
    await pool.query(`UPDATE business_settings SET store_premium_themes = true WHERE business_id = $1`, [BIZ]);
    expect(await premiumFlagOn(BIZ)).toBe(true);
    await pool.query(`UPDATE business_settings SET store_premium_themes = false WHERE business_id = $1`, [BIZ]);
    expect(await premiumFlagOn(BIZ)).toBe(false);
  });

  it('a business without a settings row has the stored switch off', async () => {
    expect(await premiumFlagOn(randomUUID())).toBe(false);
  });

  it('premium themes follow the stored switch only once they stop being free', async () => {
    // While PREMIUM_THEMES_FREE every store may create premium presets, whatever its column says.
    expect(await premiumThemesEnabled(BIZ)).toBe(PREMIUM_THEMES_FREE ? true : false);
    expect(await premiumThemesEnabled(randomUUID())).toBe(PREMIUM_THEMES_FREE ? true : false);
  });
});
