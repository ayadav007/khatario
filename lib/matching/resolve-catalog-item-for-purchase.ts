/**
 * Server-side: resolve purchase line text to a catalogue item id for stock / validation.
 * Uses exact (normalized) name, optional HSN match, then fuzzy name (same scoring as invoice item matcher).
 */

import type { PoolClient } from 'pg';
import { calculateItemNameSimilarity } from '@/lib/matching/item-name-similarity';

/** Minimum fuzzy score to auto-link without user picking from dropdown */
const FUZZY_AUTO_LINK_MIN = 65;
/** If #1 and #2 scores are within this gap, treat as ambiguous and do not auto-link */
const MIN_SCORE_GAP = 3;

function normalizeHsn(h: string): string {
  return h.replace(/[\s-]/g, '').toUpperCase();
}

/** Till / retail bills often prefix lines with "L " (loose); try alias without it for matching. */
function purchaseLineNameVariants(raw: string): string[] {
  const t = String(raw || '').trim();
  if (!t) return [];
  const out = new Set<string>();
  out.add(t);
  const stripL = t.replace(/^L\s+/i, '').trim();
  if (stripL && stripL !== t) out.add(stripL);
  return [...out];
}

export async function resolveCatalogItemIdForPurchase(
  client: PoolClient,
  businessId: string,
  params: { name: string; hsn_sac?: string | null },
): Promise<string | null> {
  const rawName = String(params.name || '').trim();
  if (!rawName) return null;

  const variants = purchaseLineNameVariants(rawName);

  for (const v of variants) {
    const exact = await client.query(
      `
      SELECT id FROM items
      WHERE business_id = $1
        AND LOWER(REGEXP_REPLACE(TRIM(name), '\\s+', ' ', 'g')) = LOWER(REGEXP_REPLACE(TRIM($2::text), '\\s+', ' ', 'g'))
        AND (is_active IS NULL OR is_active = true)
      LIMIT 2
    `,
      [businessId, v],
    );
    if (exact.rows.length === 1) {
      return exact.rows[0].id as string;
    }
  }

  const hsnRaw = params.hsn_sac?.trim();
  if (hsnRaw && normalizeHsn(hsnRaw).length >= 4) {
    const nh = normalizeHsn(hsnRaw);
    const hsnRes = await client.query(
      `
      SELECT id FROM items
      WHERE business_id = $1
        AND hsn_sac IS NOT NULL
        AND UPPER(REPLACE(REPLACE(TRIM(hsn_sac), '-', ''), ' ', '')) = $2
        AND (is_active IS NULL OR is_active = true)
    `,
      [businessId, nh],
    );
    if (hsnRes.rows.length === 1) {
      return hsnRes.rows[0].id as string;
    }
  }

  const all = await client.query(
    `
    SELECT id, name FROM items
    WHERE business_id = $1
      AND (is_active IS NULL OR is_active = true)
  `,
    [businessId],
  );

  const scored = (all.rows as { id: string; name: string }[]).map((row) => {
    let score = 0;
    for (const v of variants) {
      score = Math.max(score, calculateItemNameSimilarity(v, row.name));
    }
    return { id: row.id, score };
  });
  scored.sort((a, b) => b.score - a.score);
  if (scored.length === 0) return null;

  const top = scored[0];
  const second = scored[1];
  if (top.score < FUZZY_AUTO_LINK_MIN) return null;
  if (second && top.score - second.score < MIN_SCORE_GAP) return null;
  return top.id;
}
