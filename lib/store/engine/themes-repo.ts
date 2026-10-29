import type { PoolClient } from 'pg';
import { getPool, queryOne, queryRows } from '@/lib/db';
import type { ThemeData, ThemePreset, ThemeRow } from './types';
import { ENGINE_LIMITS, sanitizeThemeData, themeTooLarge } from './sanitize';
import { presetTheme, type PresetContext } from './presets';

export type RepoResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: 'not_found' | 'conflict' | 'limit' | 'too_large' | 'live_locked' };

const NAME_MAX = 60;

// Microsecond ISO string so an optimistic-lock token survives the round trip through the browser.
const UPDATED_AT = `to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
const META_COLS = `id, business_id, name, role, preset, ${UPDATED_AT} AS updated_at`;
const ROW_COLS = `${META_COLS}, data`;

const fail = <T>(code: Extract<RepoResult<T>, { ok: false }>['code']): RepoResult<T> => ({ ok: false, code });
const good = <T>(value: T): RepoResult<T> => ({ ok: true, value });

export async function listThemes(businessId: string): Promise<Omit<ThemeRow, 'data'>[]> {
  return queryRows<Omit<ThemeRow, 'data'>>(
    `SELECT ${META_COLS} FROM store_themes WHERE business_id = $1 ORDER BY (role = 'live') DESC, updated_at DESC`,
    [businessId],
  );
}

export async function getTheme(businessId: string, id: string): Promise<ThemeRow | null> {
  return queryOne<ThemeRow>(`SELECT ${ROW_COLS} FROM store_themes WHERE business_id = $1 AND id = $2`, [businessId, id]);
}

export async function getLiveTheme(businessId: string): Promise<ThemeRow | null> {
  return queryOne<ThemeRow>(`SELECT ${ROW_COLS} FROM store_themes WHERE business_id = $1 AND role = 'live'`, [businessId]);
}

async function inTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // the original error matters more than a failed rollback
    }
    throw err;
  } finally {
    client.release();
  }
}

export async function createTheme(
  businessId: string,
  userId: string,
  input: { name: string; preset?: ThemePreset; duplicateOf?: string; ctx: PresetContext },
): Promise<RepoResult<ThemeRow>> {
  return inTransaction(async (client) => {
    // Serialise creates per business so the 20-theme limit and "first theme is live" cannot race.
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`store_themes:${businessId}`]);

    let preset: ThemePreset = input.preset ?? 'studio';
    let data: ThemeData;
    let name = input.name.trim();
    if (input.duplicateOf) {
      const src = await client.query(`SELECT name, preset, data FROM store_themes WHERE business_id = $1 AND id = $2`, [
        businessId,
        input.duplicateOf,
      ]);
      if (src.rows.length === 0) return fail<ThemeRow>('not_found');
      data = src.rows[0].data as ThemeData;
      preset = src.rows[0].preset as ThemePreset;
      if (!name) name = `Copy of ${src.rows[0].name as string}`;
    } else {
      data = sanitizeThemeData(presetTheme(preset, input.ctx));
      if (!name) name = 'Untitled theme';
    }
    name = name.slice(0, NAME_MAX);

    const res = await client.query(
      `INSERT INTO store_themes (business_id, name, role, preset, data, updated_by)
       SELECT $1, $2,
              CASE WHEN EXISTS (SELECT 1 FROM store_themes WHERE business_id = $1 AND role = 'live') THEN 'draft' ELSE 'live' END,
              $3, $4::jsonb, $5
       WHERE (SELECT count(*) FROM store_themes WHERE business_id = $1) < $6
       RETURNING ${ROW_COLS}`,
      [businessId, name, preset, JSON.stringify(data), userId, ENGINE_LIMITS.themesPerBusiness],
    );
    if (res.rows.length === 0) return fail<ThemeRow>('limit');
    return good(res.rows[0] as ThemeRow);
  });
}

export async function saveTheme(
  businessId: string,
  userId: string,
  id: string,
  data: unknown,
  expectedUpdatedAt: string | null,
): Promise<RepoResult<ThemeRow>> {
  const clean = sanitizeThemeData(data);
  if (themeTooLarge(clean)) return fail('too_large');

  const updated = await queryOne<ThemeRow>(
    `UPDATE store_themes SET data = $3::jsonb, updated_by = $4, updated_at = NOW()
     WHERE business_id = $1 AND id = $2 AND role = 'draft'
       AND ($5::text IS NULL OR ${UPDATED_AT} = $5)
     RETURNING ${ROW_COLS}`,
    [businessId, id, JSON.stringify(clean), userId, expectedUpdatedAt],
  );
  if (updated) return good(updated);

  const current = await queryOne<{ role: string }>(`SELECT role FROM store_themes WHERE business_id = $1 AND id = $2`, [businessId, id]);
  if (!current) return fail('not_found');
  if (current.role === 'live') return fail('live_locked');
  return fail('conflict');
}

export async function renameTheme(businessId: string, id: string, name: string): Promise<RepoResult<ThemeRow>> {
  const trimmed = typeof name === 'string' ? name.trim() : '';
  // The result codes have no "invalid"; an unusable name is reported as a conflict with the allowed shape.
  if (trimmed.length < 1 || trimmed.length > NAME_MAX) return fail('conflict');
  const row = await queryOne<ThemeRow>(
    `UPDATE store_themes SET name = $3, updated_at = NOW() WHERE business_id = $1 AND id = $2 RETURNING ${ROW_COLS}`,
    [businessId, id, trimmed],
  );
  return row ? good(row) : fail('not_found');
}

export async function deleteTheme(businessId: string, id: string): Promise<RepoResult<true>> {
  const deleted = await queryOne<{ id: string }>(
    `DELETE FROM store_themes WHERE business_id = $1 AND id = $2 AND role = 'draft' RETURNING id`,
    [businessId, id],
  );
  if (deleted) return good(true as const);
  const current = await queryOne<{ role: string }>(`SELECT role FROM store_themes WHERE business_id = $1 AND id = $2`, [businessId, id]);
  return current ? fail('live_locked') : fail('not_found');
}

export async function publishTheme(businessId: string, userId: string, id: string): Promise<RepoResult<ThemeRow>> {
  return inTransaction(async (client) => {
    // Lock every theme row of the business so two publishes queue instead of both going live.
    const rows = await client.query(`SELECT id, role FROM store_themes WHERE business_id = $1 FOR UPDATE`, [businessId]);
    const target = rows.rows.find((r) => r.id === id);
    if (!target) return fail<ThemeRow>('not_found');

    if (target.role === 'live') {
      const same = await client.query(`SELECT ${ROW_COLS} FROM store_themes WHERE business_id = $1 AND id = $2`, [businessId, id]);
      return good(same.rows[0] as ThemeRow);
    }

    await client.query(
      `UPDATE store_themes SET role = 'draft', updated_at = NOW() WHERE business_id = $1 AND role = 'live'`,
      [businessId],
    );
    const published = await client.query(
      `UPDATE store_themes SET role = 'live', updated_by = $3, updated_at = NOW()
       WHERE business_id = $1 AND id = $2 RETURNING ${ROW_COLS}`,
      [businessId, id, userId],
    );
    const row = published.rows[0] as ThemeRow;
    await client.query(
      `INSERT INTO store_theme_versions (theme_id, business_id, data, published_by) VALUES ($1, $2, $3::jsonb, $4)`,
      [id, businessId, JSON.stringify(row.data), userId],
    );
    await client.query(
      `DELETE FROM store_theme_versions
       WHERE business_id = $1 AND id NOT IN (
         SELECT id FROM store_theme_versions WHERE business_id = $1 ORDER BY published_at DESC, id DESC LIMIT $2
       )`,
      [businessId, ENGINE_LIMITS.versionsKept],
    );
    return good(row);
  });
}
