// Server-only. Published theme versions: one timeline per business, newest 30 kept (D44, D45, D46, D49).
// A version keeps the theme's name and preset at publish time and outlives its theme (theme_id becomes null).
import type { PoolClient } from 'pg';
import { queryOne, queryRows } from '@/lib/db';
import type { ThemeRow, ThemeVersionRow, ThemeVersionSummary } from './types';
import { ENGINE_LIMITS } from './shared';

const NAME_MAX = 60;

// Microsecond ISO string, like themes-repo's UPDATED_AT, so a version previewed as a theme has a stable updated_at.
const PUBLISHED_AT = `to_char(v.published_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
const SUMMARY_COLS = `v.id, v.theme_id,
  COALESCE(v.theme_name, 'Published theme') AS theme_name,
  COALESCE(v.preset, 'studio') AS preset,
  ${PUBLISHED_AT} AS published_at,
  u.name AS published_by_name,
  (v.theme_id IS NOT NULL) AS theme_exists`;
const FROM = `FROM store_theme_versions v LEFT JOIN users u ON u.id = v.published_by`;

/** The business's versions, newest first, at most `ENGINE_LIMITS.versionsKept`. */
export async function listVersions(businessId: string): Promise<ThemeVersionSummary[]> {
  return queryRows<ThemeVersionSummary>(
    `SELECT ${SUMMARY_COLS} ${FROM}
      WHERE v.business_id = $1
      ORDER BY v.published_at DESC, v.id DESC
      LIMIT $2`,
    [businessId, ENGINE_LIMITS.versionsKept],
  );
}

/** One version with its data; null for an unknown id or another business's version. */
export async function getVersion(businessId: string, versionId: string): Promise<ThemeVersionRow | null> {
  return queryOne<ThemeVersionRow>(
    `SELECT ${SUMMARY_COLS}, v.business_id, v.data ${FROM} WHERE v.business_id = $1 AND v.id = $2`,
    [businessId, versionId],
  );
}

/** A version shown as a read-only theme (D47): its own id, a draft that is never the working draft. Pure. */
export function versionAsTheme(v: ThemeVersionRow): ThemeRow {
  return {
    id: v.id,
    business_id: v.business_id,
    name: v.theme_name,
    role: 'draft',
    preset: v.preset,
    data: v.data,
    updated_at: v.published_at,
    is_working: false,
  };
}

/**
 * Caller holds the business advisory lock inside a transaction. Records `row` as published by `userId` (the session
 * user, or null from the migration script; never a client value), then prunes the business to the newest 30.
 */
export async function insertVersionLocked(
  client: PoolClient,
  businessId: string,
  row: Pick<ThemeRow, 'id' | 'name' | 'preset' | 'data'>,
  userId: string | null,
): Promise<void> {
  await client.query(
    `INSERT INTO store_theme_versions (theme_id, business_id, data, preset, theme_name, published_by)
     VALUES ($1, $2, $3::jsonb, $4, $5, $6)`,
    [row.id, businessId, JSON.stringify(row.data), row.preset, row.name.slice(0, NAME_MAX), userId],
  );
  await pruneVersionsLocked(client, businessId);
}

/** Caller holds the business advisory lock. Keeps this business's newest 30 versions; returns how many were deleted. */
export async function pruneVersionsLocked(client: PoolClient, businessId: string): Promise<number> {
  const res = await client.query(
    `DELETE FROM store_theme_versions
      WHERE business_id = $1 AND id NOT IN (
        SELECT id FROM store_theme_versions WHERE business_id = $1 ORDER BY published_at DESC, id DESC LIMIT $2
      )`,
    [businessId, ENGINE_LIMITS.versionsKept],
  );
  return res.rowCount ?? 0;
}
