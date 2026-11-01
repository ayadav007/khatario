/**
 * Theme popularity against real PostgreSQL: live themes counted per preset.
 * Runs only when PHASE2_TEST_DATABASE_URL points at a disposable database with the store engine migrations applied.
 */
import { randomUUID } from 'crypto';
import type { Pool } from 'pg';

const url = process.env.PHASE2_TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
const d = url ? describe : describe.skip;

jest.mock('@/lib/queue/redis', () => ({ getRedisConnection: () => null }));
jest.mock('next/cache', () => ({ unstable_cache: (fn: unknown) => fn }));

import { getPool, closePool } from '@/lib/db';
import { countLiveThemesByPreset } from '@/lib/store/engine/theme-popularity';

d('theme popularity (real DB)', () => {
  jest.setTimeout(60000);
  let pool: Pool;
  const A = randomUUID();
  const B = randomUUID();
  const C = randomUUID();

  beforeAll(async () => {
    pool = getPool();
    for (const id of [A, B, C]) {
      await pool.query(
        `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type) VALUES ($1, 'Popularity test', '29AAAPA1234A1Z5', '29', 'regular')`,
        [id],
      );
    }
    const add = (biz: string, preset: string, role: string) =>
      pool.query(`INSERT INTO store_themes (business_id, name, role, preset, data) VALUES ($1, $2, $3, $4, '{}'::jsonb)`, [biz, `${preset} ${role}`, role, preset]);
    await add(A, 'heritage', 'live');
    await add(B, 'heritage', 'live');
    await add(C, 'grocery', 'live');
    await add(C, 'heritage', 'draft');
  });

  afterAll(async () => {
    if (pool) {
      await pool.query(`DELETE FROM store_themes WHERE business_id = ANY($1)`, [[A, B, C]]);
      await pool.query(`DELETE FROM businesses WHERE id = ANY($1)`, [[A, B, C]]);
    }
    await closePool();
  });

  it('counts only live themes, per preset', async () => {
    const before = await countLiveThemesByPreset();
    expect(before.heritage ?? 0).toBeGreaterThanOrEqual(2);
    // Three new live themes, the draft not counted: compare against a run without them.
    await pool.query(`UPDATE store_themes SET role = 'draft' WHERE business_id = ANY($1)`, [[A, B, C]]);
    const without = await countLiveThemesByPreset();
    expect((before.heritage ?? 0) - (without.heritage ?? 0)).toBe(2);
    expect((before.grocery ?? 0) - (without.grocery ?? 0)).toBe(1);
  });
});
