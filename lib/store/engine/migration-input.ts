// Server-only. What `migrateStoreTheme` needs for one business (D33, M4 7). Kept apart from `migrate-runner.ts` so
// `themes-repo.ts` can read it without importing the runner (which imports the repo).
import type { PoolClient, QueryResultRow } from 'pg';
import { queryOne, queryRows } from '@/lib/db';
import { buildStoreItemsQuery } from '@/lib/store/store-items-query';
import type { MigrationContext } from './migrate';

export interface MigrationInput {
  raw: unknown;
  ctx: MigrationContext;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface InputRow {
  name: string | null;
  logo_url: string | null;
  store_tagline: string | null;
  store_about_md: string | null;
  store_hero_image_url: string | null;
  store_theme: unknown;
}

/**
 * The store theme and the store facts `migrateStoreTheme` snapshots, or null when the business has no store
 * settings row (there is no store design to migrate). With `client` (M4 6), every read goes through that
 * connection, so a caller holding the business lock does no nested pool reads.
 */
export async function migrationInputFor(businessId: string, client?: PoolClient): Promise<MigrationInput | null> {
  if (!UUID_RE.test(businessId)) return null;
  const one = async <T extends QueryResultRow>(sql: string, params: unknown[]): Promise<T | null> =>
    client ? (((await client.query(sql, params)).rows[0] as T | undefined) ?? null) : queryOne<T>(sql, params);
  const rows = async <T extends QueryResultRow>(sql: string, params: unknown[]): Promise<T[]> =>
    client ? ((await client.query(sql, params)).rows as T[]) : queryRows<T>(sql, params);

  const row = await one<InputRow>(
    `SELECT b.name, b.logo_url, bs.store_tagline, bs.store_about_md, bs.store_hero_image_url, bs.store_theme
       FROM businesses b
       JOIN business_settings bs ON bs.business_id = b.id
      WHERE b.id = $1`,
    [businessId],
  );
  if (!row) return null;
  // The same category list the storefront's section data reads (section-data `storeCategories`).
  const q = buildStoreItemsQuery({ businessId, limit: 1, offset: 0 });
  const categories = (await rows<{ id: string; name: string }>(q.categorySql, q.categoryParams)).map((c) => ({
    id: c.id,
    name: c.name,
  }));
  return {
    raw: row.store_theme ?? null,
    ctx: {
      businessName: row.name ?? '',
      tagline: row.store_tagline ?? '',
      aboutMd: row.store_about_md ?? '',
      heroUrl: row.store_hero_image_url ?? '',
      logoUrl: row.logo_url ?? '',
      categories,
    },
  };
}
