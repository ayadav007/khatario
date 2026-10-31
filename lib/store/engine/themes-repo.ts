import type { PoolClient } from 'pg';
import { getPool, queryOne, queryRows } from '@/lib/db';
import { STORE_THEME_PRESETS } from '@/lib/store/store-theme';
import type { ThemeData, ThemeListRow, ThemePreset, ThemeRow } from './types';
import { ENGINE_LIMITS, sanitizeThemeData, themeTooLarge } from './sanitize';
import { presetTheme, type PresetContext } from './presets';
import { presetContextFor, presetContextFromRow } from './preset-context';
import { migrateStoreTheme } from './migrate';
import { migrationInputFor, type MigrationInput } from './migration-input';
import { insertVersionLocked } from './versions-repo';

export type { MigrationInput } from './migration-input';

export type RepoResult<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      code: 'not_found' | 'conflict' | 'limit' | 'too_large' | 'live_locked' | 'working_locked' | 'no_store_design';
    };

/** Where a new library theme comes from (D43): a preset (or a duplicate), or the store's current design. */
export type ThemeSource = 'preset' | 'migrated';

const NAME_MAX = 60;

// Microsecond ISO string so an optimistic-lock token survives the round trip through the browser.
const UPDATED_AT = `to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
const META_COLS = `id, business_id, name, role, preset, is_working, ${UPDATED_AT} AS updated_at`;
const ROW_COLS = `${META_COLS}, data`;

const fail = <T>(code: Extract<RepoResult<T>, { ok: false }>['code']): RepoResult<T> => ({ ok: false, code });
const good = <T>(value: T): RepoResult<T> => ({ ok: true, value });

/** D40: `has_changes` is true only for the working draft, and only when its data or preset differs from the live theme. */
export async function listThemes(businessId: string): Promise<ThemeListRow[]> {
  return queryRows<ThemeListRow>(
    `SELECT ${META_COLS},
            (t.is_working AND EXISTS (
              SELECT 1 FROM store_themes l
               WHERE l.business_id = t.business_id AND l.role = 'live'
                 AND (l.data IS DISTINCT FROM t.data OR l.preset IS DISTINCT FROM t.preset)
            )) AS has_changes
       FROM store_themes t
      WHERE t.business_id = $1
      ORDER BY (t.role = 'live') DESC, t.updated_at DESC`,
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

const FROM_STORE_SUFFIX = ' (from your store)';
export const TOO_LARGE_FALLBACK_WARNING = 'Your store design was too large to copy; the Studio theme was used instead';

/**
 * Creates a theme. Under the business lock, when the business has no live theme yet, the store's migrated design is
 * inserted as the live theme first (D33), so the requested theme becomes a draft beside it. The migration input is
 * read only then (M4 5). A business with no store settings row has no design to migrate: its first theme is live (M1).
 * - `source: 'migrated'` (D43): a draft of the store's current design, named "<preset label> (from your store)"
 *   unless a name is given; `no_store_design` when there is nothing to migrate from, `too_large` over the cap.
 * - otherwise a preset, or a copy of `duplicateOf`.
 * Every path goes through the same locked 20-theme check (`limit`).
 */
export async function createTheme(
  businessId: string,
  userId: string,
  input: { name: string; preset?: ThemePreset; duplicateOf?: string; source?: ThemeSource; ctx: PresetContext },
): Promise<RepoResult<ThemeRow>> {
  return inTransaction(async (client) => {
    await lockBusinessThemes(client, businessId);
    const live = await client.query(`SELECT 1 FROM store_themes WHERE business_id = $1 AND role = 'live'`, [businessId]);
    let migration: MigrationInput | null | undefined;
    if (live.rows.length === 0) {
      migration = await migrationInputFor(businessId, client);
      if (migration && !(await insertMigratedLiveLocked(client, businessId, userId, migration))) return fail<ThemeRow>('limit');
    }
    if (input.source === 'migrated') {
      if (migration === undefined) migration = await migrationInputFor(businessId, client);
      if (!migration) return fail<ThemeRow>('no_store_design');
      const result = migrateStoreTheme(migration.raw, migration.ctx);
      const data = sanitizeThemeData(result.data);
      if (themeTooLarge(data)) return fail<ThemeRow>('too_large');
      const name = input.name.trim() || withSuffix(result.name, FROM_STORE_SUFFIX);
      return insertThemeLocked(client, businessId, userId, { name, preset: result.preset, data });
    }
    return createThemeLocked(client, businessId, userId, input);
  });
}

/**
 * D33. Caller holds the business advisory lock inside a transaction. Inserts the migrated design as the live theme
 * when the business has none; null when a live theme exists or the business is at the theme limit (the caller
 * reports `limit`). `userId` (the session user, or null from the migration script) is the live row's `updated_by`.
 * - M4 4: a migrated design over the size cap falls back to the Studio preset, with a warning.
 * - D49, R16: the row is also recorded as the first version, always with a null author ("Set up automatically").
 */
export async function insertMigratedLiveLocked(
  client: PoolClient,
  businessId: string,
  userId: string | null,
  input: MigrationInput,
): Promise<{ theme: ThemeRow; warnings: string[] } | null> {
  const result = migrateStoreTheme(input.raw, input.ctx);
  let { preset, name } = result;
  const warnings = [...result.warnings];
  let data = sanitizeThemeData(result.data);
  if (themeTooLarge(data)) {
    // The store facts presetContextFor reads, taken from the input so nothing is read outside this transaction.
    const ctx = presetContextFromRow({
      name: input.ctx.businessName,
      tagline: input.ctx.tagline,
      store_theme: input.raw,
      hero_url: input.ctx.heroUrl,
    });
    preset = 'studio';
    name = STORE_THEME_PRESETS.studio.label;
    data = sanitizeThemeData(presetTheme('studio', ctx));
    warnings.push(TOO_LARGE_FALLBACK_WARNING);
  }
  const res = await client.query(
    `INSERT INTO store_themes (business_id, name, role, preset, data, updated_by)
     SELECT $1, $2, 'live', $3, $4::jsonb, $5
     WHERE NOT EXISTS (SELECT 1 FROM store_themes WHERE business_id = $1 AND role = 'live')
       AND (SELECT count(*) FROM store_themes WHERE business_id = $1) < $6
     RETURNING ${ROW_COLS}`,
    [businessId, name.slice(0, NAME_MAX), preset, JSON.stringify(data), userId, ENGINE_LIMITS.themesPerBusiness],
  );
  if (res.rows.length === 0) return null;
  const theme = res.rows[0] as ThemeRow;
  // D49: the store's pre-engine design is its first version, so it can be restored after the first publish.
  await insertVersionLocked(client, businessId, theme, null);
  return { theme, warnings };
}

// Serialise creates per business so the 20-theme limit and "first theme is live" cannot race.
export async function lockBusinessThemes(client: PoolClient, businessId: string): Promise<void> {
  await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`store_themes:${businessId}`]);
}

/** Caller holds the business advisory lock inside a transaction. A preset theme, or a copy of `duplicateOf`. */
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
    return insertThemeLocked(client, businessId, userId, { name, preset, data });
  }
}

/** Caller holds the business advisory lock. The first theme is live, any other a draft; `limit` at 20 themes. */
async function insertThemeLocked(
  client: PoolClient,
  businessId: string,
  userId: string,
  theme: { name: string; preset: ThemePreset; data: ThemeData },
): Promise<RepoResult<ThemeRow>> {
  const res = await client.query(
    `INSERT INTO store_themes (business_id, name, role, preset, data, updated_by)
     SELECT $1, $2,
            CASE WHEN EXISTS (SELECT 1 FROM store_themes WHERE business_id = $1 AND role = 'live') THEN 'draft' ELSE 'live' END,
            $3, $4::jsonb, $5
     WHERE (SELECT count(*) FROM store_themes WHERE business_id = $1) < $6
     RETURNING ${ROW_COLS}`,
    [businessId, theme.name.slice(0, NAME_MAX), theme.preset, JSON.stringify(theme.data), userId, ENGINE_LIMITS.themesPerBusiness],
  );
  if (res.rows.length === 0) return fail<ThemeRow>('limit');
  return good(res.rows[0] as ThemeRow);
}

const EDITING_SUFFIX = ' (editing)';
const DETACHED_SUFFIX = ' (unpublished edits)';

const baseName = (name: string): string => (name.endsWith(EDITING_SUFFIX) ? name.slice(0, -EDITING_SUFFIX.length) : name);
/** `base` cut so that `suffix` always fits within the 60-character name. */
function withSuffix(base: string, suffix: string): string {
  return `${base.slice(0, NAME_MAX - suffix.length)}${suffix}`;
}

/** "<live name> (editing)", never doubled when the live name already ends with it. */
function workingDraftName(liveName: string): string {
  return withSuffix(baseName(liveName), EDITING_SUFFIX);
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
      const input = await migrationInputFor(businessId, client);
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

/**
 * D41 Discard changes: under the business lock, the working draft takes the live theme's data, preset and name again
 * and its `updated_at` moves (an editor open on it gets the 409 conflict). `not_found` when there is no working draft.
 */
export async function resetWorkingDraft(businessId: string, userId: string): Promise<RepoResult<ThemeRow>> {
  return inTransaction(async (client) => {
    await lockBusinessThemes(client, businessId);
    const live = (await client.query(`SELECT name FROM store_themes WHERE business_id = $1 AND role = 'live'`, [businessId]))
      .rows[0] as { name: string } | undefined;
    if (!live) return fail<ThemeRow>('not_found');
    const res = await client.query(
      `UPDATE store_themes
          SET data = (SELECT data FROM store_themes WHERE business_id = $1 AND role = 'live'),
              preset = (SELECT preset FROM store_themes WHERE business_id = $1 AND role = 'live'),
              name = $2, updated_by = $3, updated_at = NOW()
        WHERE business_id = $1 AND is_working
        RETURNING ${ROW_COLS}`,
      [businessId, workingDraftName(live.name), userId],
    );
    return res.rows.length > 0 ? good(res.rows[0] as ThemeRow) : fail<ThemeRow>('not_found');
  });
}

/** D42: deletes only a draft that is not the working draft. Live is `live_locked`, the working draft `working_locked`. */
export async function deleteTheme(businessId: string, id: string): Promise<RepoResult<true>> {
  const deleted = await queryOne<{ id: string }>(
    `DELETE FROM store_themes WHERE business_id = $1 AND id = $2 AND role = 'draft' AND NOT is_working RETURNING id`,
    [businessId, id],
  );
  if (deleted) return good(true as const);
  const current = await queryOne<{ role: string; is_working: boolean }>(
    `SELECT role, is_working FROM store_themes WHERE business_id = $1 AND id = $2`,
    [businessId, id],
  );
  if (!current) return fail('not_found');
  return current.role === 'live' ? fail('live_locked') : fail('working_locked');
}

/**
 * Puts a draft live, recording a version of the live row (the business keeps its newest 30).
 * - The working draft (R11): its data and preset are copied onto the live theme, and it stays the working draft
 *   with the same id, so the editor keeps editing it and no rows pile up.
 * - Any other draft X (the theme library): roles swap; the old live theme becomes a draft. Then (D40, M2 N2) the
 *   working draft W can no longer put the old design back: with no changes against the old live theme it is
 *   refreshed from X (data, preset, "<X> (editing)"); with unpublished changes it is detached as an ordinary draft
 *   named "<old base> (unpublished edits)", and the next Customise copies X.
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
         SET data = (SELECT data FROM store_themes WHERE business_id = $1 AND id = $3),
             preset = (SELECT preset FROM store_themes WHERE business_id = $1 AND id = $3),
             updated_by = $4, updated_at = NOW()
         WHERE business_id = $1 AND id = $2
         RETURNING ${ROW_COLS}`,
        [businessId, live.id, id, userId],
      );
      row = copied.rows[0] as ThemeRow;
    } else {
      // D40: whether W differs from the old live theme, read before the swap (the swap changes only roles).
      const working = rows.rows.find((r) => r.is_working && r.id !== id);
      let before: { name: string; clean: boolean } | undefined;
      if (working && live) {
        const cmp = await client.query(
          `SELECT w.name, (w.data IS NOT DISTINCT FROM l.data AND w.preset IS NOT DISTINCT FROM l.preset) AS clean
             FROM store_themes w, store_themes l
            WHERE w.business_id = $1 AND w.id = $2 AND l.business_id = $1 AND l.id = $3`,
          [businessId, working.id, live.id],
        );
        before = cmp.rows[0];
      }

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

      if (working && before) {
        if (before.clean) {
          // Refreshed from X; the new updated_at gives an editor open on W the existing 409 conflict.
          await client.query(
            `UPDATE store_themes
                SET data = (SELECT data FROM store_themes WHERE business_id = $1 AND id = $3),
                    preset = (SELECT preset FROM store_themes WHERE business_id = $1 AND id = $3),
                    name = $4, updated_by = $5, updated_at = NOW()
              WHERE business_id = $1 AND id = $2`,
            [businessId, working.id, id, workingDraftName(row.name), userId],
          );
        } else {
          // Its edits survive as an ordinary library draft.
          await client.query(
            `UPDATE store_themes SET is_working = false, name = $3, updated_at = NOW() WHERE business_id = $1 AND id = $2`,
            [businessId, working.id, withSuffix(baseName(before.name), DETACHED_SUFFIX)],
          );
        }
      }
    }
    await insertVersionLocked(client, businessId, row, userId);
    return good(row);
  });
}
