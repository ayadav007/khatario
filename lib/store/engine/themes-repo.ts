import type { PoolClient } from 'pg';
import { getPool, queryOne, queryRows } from '@/lib/db';
import type { ThemeData, ThemePreset, ThemeRow } from './types';
import { ENGINE_LIMITS, sanitizeThemeData, themeTooLarge } from './sanitize';
import { presetTheme, type PresetContext } from './presets';
import { presetContextFor } from './preset-context';
import { migrateStoreTheme, type MigrationContext } from './migrate';
import { migrationInputFor } from './migrate-runner';

export type RepoResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: 'not_found' | 'conflict' | 'limit' | 'too_large' | 'live_locked' };

const NAME_MAX = 60;

// Microsecond ISO string so an optimistic-lock token survives the round trip through the browser.
const UPDATED_AT = `to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
const META_COLS = `id, business_id, name, role, preset, is_working, ${UPDATED_AT} AS updated_at`;
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

export interface MigrationInput {
  raw: unknown;
  ctx: MigrationContext;
}

/**
 * Creates a theme. With `migrate` (D33) and no live theme yet, the store's migrated design is inserted as the live
 * theme first, so the requested theme becomes a draft beside it. Without `migrate`, the first theme is live (M1).
 */
export async function createTheme(
  businessId: string,
  userId: string,
  input: { name: string; preset?: ThemePreset; duplicateOf?: string; ctx: PresetContext; migrate?: MigrationInput | null },
): Promise<RepoResult<ThemeRow>> {
  return inTransaction(async (client) => {
    await lockBusinessThemes(client, businessId);
    if (input.migrate) await insertMigratedLiveLocked(client, businessId, userId, input.migrate);
    return createThemeLocked(client, businessId, userId, input);
  });
}

/**
 * D33. Caller holds the business advisory lock inside a transaction. Inserts the migrated design as the live theme
 * when the business has none; null when a live theme exists or the business is at the theme limit (the caller
 * reports `limit`). `userId` is the session user, or null from the migration script.
 */
export async function insertMigratedLiveLocked(
  client: PoolClient,
  businessId: string,
  userId: string | null,
  input: MigrationInput,
): Promise<{ theme: ThemeRow; warnings: string[] } | null> {
  const result = migrateStoreTheme(input.raw, input.ctx);
  const data = sanitizeThemeData(result.data);
  if (themeTooLarge(data)) throw new Error('The migrated theme is larger than the theme size limit');
  const res = await client.query(
    `INSERT INTO store_themes (business_id, name, role, preset, data, updated_by)
     SELECT $1, $2, 'live', $3, $4::jsonb, $5
     WHERE NOT EXISTS (SELECT 1 FROM store_themes WHERE business_id = $1 AND role = 'live')
       AND (SELECT count(*) FROM store_themes WHERE business_id = $1) < $6
     RETURNING ${ROW_COLS}`,
    [businessId, result.name.slice(0, NAME_MAX), result.preset, JSON.stringify(data), userId, ENGINE_LIMITS.themesPerBusiness],
  );
  if (res.rows.length === 0) return null;
  return { theme: res.rows[0] as ThemeRow, warnings: result.warnings };
}

// Serialise creates per business so the 20-theme limit and "first theme is live" cannot race.
export async function lockBusinessThemes(client: PoolClient, businessId: string): Promise<void> {
  await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`store_themes:${businessId}`]);
}

/** Caller holds the business advisory lock inside a transaction. */
async function createThemeLocked(
  client: PoolClient,
  businessId: string,
  userId: string,
  input: { name: string; preset?: ThemePreset; duplicateOf?: string; ctx: PresetContext },
): Promise<RepoResult<ThemeRow>> {
  {
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
  }
}

const EDITING_SUFFIX = ' (editing)';

/** "<live name> (editing)", never doubled when the live name already ends with it. */
function workingDraftName(liveName: string): string {
  const base = liveName.endsWith(EDITING_SUFFIX) ? liveName.slice(0, -EDITING_SUFFIX.length) : liveName;
  const room = NAME_MAX - EDITING_SUFFIX.length;
  return `${base.slice(0, room)}${EDITING_SUFFIX}`;
}

async function insertWorkingDraft(businessId: string, userId: string): Promise<RepoResult<ThemeRow>> {
  return inTransaction(async (client) => {
    await lockBusinessThemes(client, businessId);

    const existing = await client.query(`SELECT ${ROW_COLS} FROM store_themes WHERE business_id = $1 AND is_working`, [businessId]);
    if (existing.rows.length > 0) return good(existing.rows[0] as ThemeRow);

    let live: { name: string; preset: ThemePreset; data: ThemeData } | undefined = (
      await client.query(`SELECT name, preset, data FROM store_themes WHERE business_id = $1 AND role = 'live'`, [businessId])
    ).rows[0];
    if (!live) {
      // D33: the first live theme is the store's migrated design. Only when there is no business row to migrate
      // from does it fall back to the Studio preset.
      const input = await migrationInputFor(businessId);
      if (input) {
        const migrated = await insertMigratedLiveLocked(client, businessId, userId, input);
        if (!migrated) return fail<ThemeRow>('limit');
        live = migrated.theme;
      } else {
        const created = await createThemeLocked(client, businessId, userId, {
          name: 'Main',
          preset: 'studio',
          ctx: await presetContextFor(businessId),
        });
        if (!created.ok) return created;
        live = created.value;
      }
    }

    const name = workingDraftName(live.name);
    const res = await client.query(
      `INSERT INTO store_themes (business_id, name, role, preset, data, updated_by, is_working)
       SELECT $1, $2, 'draft', $3, $4::jsonb, $5, true
       WHERE (SELECT count(*) FROM store_themes WHERE business_id = $1) < $6
       RETURNING ${ROW_COLS}`,
      [businessId, name, live.preset, JSON.stringify(live.data), userId, ENGINE_LIMITS.themesPerBusiness],
    );
    if (res.rows.length === 0) return fail<ThemeRow>('limit');
    return good(res.rows[0] as ThemeRow);
  });
}

/** The draft the Studio edits: reuse it, or copy the live theme into a new one (creating the migrated live theme first if none, D33). */
export async function getOrCreateWorkingDraft(businessId: string, userId: string): Promise<RepoResult<ThemeRow>> {
  try {
    return await insertWorkingDraft(businessId, userId);
  } catch (err) {
    // The advisory lock should prevent this; if another writer still won the unique index, return their draft.
    const e = err as { code?: string; constraint?: string };
    if (e.code === '23505' && e.constraint === 'store_themes_one_working') {
      const existing = await queryOne<ThemeRow>(`SELECT ${ROW_COLS} FROM store_themes WHERE business_id = $1 AND is_working`, [businessId]);
      if (existing) return good(existing);
    }
    throw err;
  }
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

/**
 * Puts a draft live, recording a version (the newest 30 are kept).
 * - The working draft (R11): its data is copied onto the live theme, and it stays the working draft
 *   with the same id, so the editor keeps editing it and no rows pile up.
 * - Any other draft (the theme library): roles swap; the old live theme becomes a draft.
 */
export async function publishTheme(businessId: string, userId: string, id: string): Promise<RepoResult<ThemeRow>> {
  return inTransaction(async (client) => {
    await lockBusinessThemes(client, businessId);
    // Lock every theme row of the business so two publishes queue instead of both going live.
    const rows = await client.query(`SELECT id, role, is_working FROM store_themes WHERE business_id = $1 FOR UPDATE`, [businessId]);
    const target = rows.rows.find((r) => r.id === id);
    if (!target) return fail<ThemeRow>('not_found');

    if (target.role === 'live') {
      const same = await client.query(`SELECT ${ROW_COLS} FROM store_themes WHERE business_id = $1 AND id = $2`, [businessId, id]);
      return good(same.rows[0] as ThemeRow);
    }

    const live = rows.rows.find((r) => r.role === 'live');
    let row: ThemeRow;
    if (target.is_working && live) {
      const copied = await client.query(
        `UPDATE store_themes
         SET data = (SELECT data FROM store_themes WHERE business_id = $1 AND id = $3), updated_by = $4, updated_at = NOW()
         WHERE business_id = $1 AND id = $2
         RETURNING ${ROW_COLS}`,
        [businessId, live.id, id, userId],
      );
      row = copied.rows[0] as ThemeRow;
    } else {
      await client.query(
        `UPDATE store_themes SET role = 'draft', updated_at = NOW() WHERE business_id = $1 AND role = 'live'`,
        [businessId],
      );
      const published = await client.query(
        `UPDATE store_themes SET role = 'live', is_working = false, updated_by = $3, updated_at = NOW()
         WHERE business_id = $1 AND id = $2 RETURNING ${ROW_COLS}`,
        [businessId, id, userId],
      );
      row = published.rows[0] as ThemeRow;
    }
    await client.query(
      `INSERT INTO store_theme_versions (theme_id, business_id, data, published_by) VALUES ($1, $2, $3::jsonb, $4)`,
      [row.id, businessId, JSON.stringify(row.data), userId],
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
