/**
 * Theme names on create against real PostgreSQL: a theme added from a preset is named after the theme.
 * Runs only when PHASE2_TEST_DATABASE_URL points at a disposable database with the store engine migrations applied.
 */
import { randomUUID } from 'crypto';
import type { Pool } from 'pg';

const url = process.env.PHASE2_TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
const d = url ? describe : describe.skip;

jest.mock('@/lib/queue/redis', () => ({ getRedisConnection: () => null }));

import { getPool, closePool } from '@/lib/db';
import { createTheme } from '@/lib/store/engine/themes-repo';
import type { ThemeRow } from '@/lib/store/engine/types';

const ctx = { businessName: 'Naming test', tagline: 'Tagline' };

d('Theme names on create (real DB)', () => {
  jest.setTimeout(60000);
  let pool: Pool;
  const BIZ = randomUUID();
  const USER = randomUUID();
  const ok = (r: { ok: true; value: ThemeRow } | { ok: false; code: string }): ThemeRow => {
    if (!r.ok) throw new Error(`expected ok, got ${r.code}`);
    return r.value;
  };

  beforeAll(async () => {
    pool = getPool();
    await pool.query(
      `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type) VALUES ($1, 'Naming test', '29AAAPA1234A1Z5', '29', 'regular')`,
      [BIZ],
    );
    await pool.query(`INSERT INTO business_settings (business_id) VALUES ($1) ON CONFLICT (business_id) DO NOTHING`, [BIZ]);
  });

  afterAll(async () => {
    if (pool) {
      await pool.query(`DELETE FROM store_theme_versions WHERE business_id = $1`, [BIZ]).catch(() => undefined);
      await pool.query(`DELETE FROM store_themes WHERE business_id = $1`, [BIZ]);
      await pool.query(`DELETE FROM business_settings WHERE business_id = $1`, [BIZ]);
      await pool.query(`DELETE FROM businesses WHERE id = $1`, [BIZ]);
    }
    await closePool();
  });

  it('names a preset theme after the theme, then numbers repeats', async () => {
    const first = ok(await createTheme(BIZ, USER, { name: '', preset: 'heritage', ctx }));
    const second = ok(await createTheme(BIZ, USER, { name: '  ', preset: 'heritage', ctx }));
    expect(first.name).toBe('Heritage Couture');
    expect(second.name).toBe('Heritage Couture 2');
    expect(ok(await createTheme(BIZ, USER, { name: '', preset: 'grocery', ctx })).name).toBe('Premium Grocery');
  });

  it('keeps a typed name, and a duplicate is still "Copy of …"', async () => {
    const typed = ok(await createTheme(BIZ, USER, { name: 'My shop look', preset: 'studio', ctx }));
    expect(typed.name).toBe('My shop look');
    const copy = ok(await createTheme(BIZ, USER, { name: '', duplicateOf: typed.id, ctx }));
    expect(copy.name).toBe('Copy of My shop look');
  });
});
