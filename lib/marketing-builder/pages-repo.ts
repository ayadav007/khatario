import { query, queryOne, queryRows } from '@/lib/db';
import type { MarketingDocument } from '@/lib/marketing-builder/sanitize';
import type { MarketingPageSlug } from '@/lib/marketing-builder/block-types';

export const MARKETING_VERSIONS_KEPT = 30;

export type MarketingPageRow = {
  id: string;
  slug: string;
  draft_data: MarketingDocument | null;
  draft_updated_at: string | null;
  draft_updated_by: string | null;
  draft_updated_by_name: string | null;
  published_data: MarketingDocument | null;
  published_at: string | null;
  published_by_name: string | null;
};

export async function getMarketingPage(slug: MarketingPageSlug): Promise<MarketingPageRow | null> {
  await query('INSERT INTO marketing_pages (slug) VALUES ($1) ON CONFLICT (slug) DO NOTHING', [slug]);
  return queryOne<MarketingPageRow>(
    `SELECT mp.id, mp.slug, mp.draft_data, mp.draft_updated_at, mp.draft_updated_by,
            da.name AS draft_updated_by_name, mp.published_data, mp.published_at,
            pa.name AS published_by_name
       FROM marketing_pages mp
       LEFT JOIN platform_admins da ON da.id = mp.draft_updated_by
       LEFT JOIN platform_admins pa ON pa.id = mp.published_by
      WHERE mp.slug = $1`,
    [slug],
  );
}

/** Published document only, for the public site. Never throws: the site falls back to the coded page. */
export async function getPublishedMarketingDocument(
  slug: MarketingPageSlug,
): Promise<MarketingDocument | null> {
  try {
    const row = await queryOne<{ published_data: MarketingDocument | null }>(
      'SELECT published_data FROM marketing_pages WHERE slug = $1',
      [slug],
    );
    return row?.published_data ?? null;
  } catch (err) {
    console.error('[marketing-builder] failed to load published page', err);
    return null;
  }
}

export async function getDraftMarketingDocument(
  slug: MarketingPageSlug,
): Promise<MarketingDocument | null> {
  const row = await queryOne<{ draft_data: MarketingDocument | null; published_data: MarketingDocument | null }>(
    'SELECT draft_data, published_data FROM marketing_pages WHERE slug = $1',
    [slug],
  );
  return row?.draft_data ?? row?.published_data ?? null;
}

export async function saveMarketingDraft(
  slug: MarketingPageSlug,
  data: MarketingDocument,
  adminId: string,
): Promise<string> {
  const row = await queryOne<{ draft_updated_at: string }>(
    `INSERT INTO marketing_pages (slug, draft_data, draft_updated_at, draft_updated_by, updated_at)
     VALUES ($1, $2::jsonb, NOW(), $3, NOW())
     ON CONFLICT (slug) DO UPDATE
        SET draft_data = EXCLUDED.draft_data,
            draft_updated_at = EXCLUDED.draft_updated_at,
            draft_updated_by = EXCLUDED.draft_updated_by,
            updated_at = NOW()
     RETURNING draft_updated_at`,
    [slug, JSON.stringify(data), adminId],
  );
  return row!.draft_updated_at;
}

export async function discardMarketingDraft(slug: MarketingPageSlug): Promise<void> {
  await query(
    `UPDATE marketing_pages
        SET draft_data = NULL, draft_updated_at = NULL, draft_updated_by = NULL, updated_at = NOW()
      WHERE slug = $1`,
    [slug],
  );
}

export async function publishMarketingPage(
  slug: MarketingPageSlug,
  data: MarketingDocument,
  adminId: string,
): Promise<{ id: string; published_at: string }> {
  const json = JSON.stringify(data);
  const row = await queryOne<{ id: string; published_at: string }>(
    `WITH pub AS (
        UPDATE marketing_pages
           SET published_data = $2::jsonb, published_at = NOW(), published_by = $3,
               draft_data = NULL, draft_updated_at = NULL, draft_updated_by = NULL, updated_at = NOW()
         WHERE slug = $1
     RETURNING id, slug, published_at
     ), ver AS (
        INSERT INTO marketing_page_versions (page_slug, data, published_by)
        SELECT slug, $2::jsonb, $3 FROM pub
     )
     SELECT id, published_at FROM pub`,
    [slug, json, adminId],
  );
  if (!row) throw new Error('Marketing page not found');
  await query(
    `DELETE FROM marketing_page_versions
      WHERE page_slug = $1
        AND id NOT IN (
          SELECT id FROM marketing_page_versions WHERE page_slug = $1
           ORDER BY created_at DESC LIMIT $2
        )`,
    [slug, MARKETING_VERSIONS_KEPT],
  );
  return row;
}

export type MarketingVersionRow = {
  id: string;
  created_at: string;
  published_by_name: string | null;
  block_count: number;
};

export async function listMarketingVersions(slug: MarketingPageSlug): Promise<MarketingVersionRow[]> {
  return queryRows<MarketingVersionRow>(
    `SELECT v.id, v.created_at, a.name AS published_by_name,
            COALESCE(jsonb_array_length(v.data->'content'), 0)::int AS block_count
       FROM marketing_page_versions v
       LEFT JOIN platform_admins a ON a.id = v.published_by
      WHERE v.page_slug = $1
      ORDER BY v.created_at DESC
      LIMIT $2`,
    [slug, MARKETING_VERSIONS_KEPT],
  );
}

export async function getMarketingVersion(
  slug: MarketingPageSlug,
  id: string,
): Promise<MarketingDocument | null> {
  const row = await queryOne<{ data: MarketingDocument }>(
    'SELECT data FROM marketing_page_versions WHERE page_slug = $1 AND id = $2',
    [slug, id],
  );
  return row?.data ?? null;
}
