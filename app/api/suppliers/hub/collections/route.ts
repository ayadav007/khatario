import { NextRequest, NextResponse } from 'next/server';
import * as db from '@/lib/db';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { requireAuthenticatedTenant } from '@/lib/stock-request-security';

export const dynamic = 'force-dynamic';

const isAllowedImage = (url: string) => /^https:\/\//i.test(url) || url.startsWith('/');

/**
 * GET /api/suppliers/hub/collections — the signed-in supplier's collections, with item counts
 * and how connected buyers have ordered from each since it was published.
 */
export async function GET(request: NextRequest) {
  const auth = requireAuthenticatedTenant(request);
  if (auth instanceof NextResponse) return auth;
  try {
    await authorize(auth.userId, 'items', 'read', { businessId: auth.businessId });
    const collections = await db.queryRows(
      `
      SELECT c.*,
        (SELECT COUNT(*)::int FROM supplier_published_listings l
          WHERE l.collection_id = c.id AND l.is_active = true) AS item_count,
        stats.buyers_ordered, stats.units_ordered
      FROM supplier_collections c
      LEFT JOIN LATERAL (
        SELECT COUNT(DISTINCT o.buyer_business_id)::int AS buyers_ordered,
               COALESCE(SUM(COALESCE(ol.confirmed_qty, ol.qty)), 0)::float8 AS units_ordered
        FROM supply_order_lines ol
        JOIN supply_orders o ON o.id = ol.order_id
        JOIN supplier_published_listings l ON l.item_id = ol.vendor_item_id AND l.collection_id = c.id
        WHERE o.vendor_business_id = c.supplier_business_id
          AND o.status NOT IN ('draft', 'declined', 'cancelled')
          AND c.published_at IS NOT NULL AND o.created_at >= c.published_at
      ) stats ON true
      WHERE c.supplier_business_id = $1
      ORDER BY (c.status = 'archived'), COALESCE(c.published_at, c.created_at) DESC
      `,
      [auth.businessId]
    );
    return NextResponse.json({ collections });
  } catch (error) {
    if (error instanceof AuthorizationError) return error.toNextResponse();
    console.error('collections GET', error);
    return NextResponse.json({ error: 'Failed to load collections' }, { status: 500 });
  }
}

/** POST — create a draft collection: { name, season?, description?, cover_image_url?, audience? } */
export async function POST(request: NextRequest) {
  const auth = requireAuthenticatedTenant(request);
  if (auth instanceof NextResponse) return auth;
  try {
    await authorize(auth.userId, 'items', 'update', { businessId: auth.businessId });
    const body = await request.json().catch(() => ({}));
    const name = String(body.name || '').trim();
    if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 });
    const cover = body.cover_image_url ? String(body.cover_image_url).trim() : '';
    if (cover && !isAllowedImage(cover)) {
      return NextResponse.json({ error: 'Cover must be an https:// link or an uploaded file path' }, { status: 400 });
    }
    const row = await db.queryOne(
      `INSERT INTO supplier_collections (supplier_business_id, name, season, description, cover_image_url, audience)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        auth.businessId,
        name.slice(0, 120),
        body.season ? String(body.season).slice(0, 60) : null,
        body.description ? String(body.description).slice(0, 2000) : null,
        cover || null,
        body.audience === 'public_preview' ? 'public_preview' : 'linked_only',
      ]
    );
    return NextResponse.json({ collection: row }, { status: 201 });
  } catch (error) {
    if (error instanceof AuthorizationError) return error.toNextResponse();
    console.error('collections POST', error);
    return NextResponse.json({ error: 'Failed to create the collection' }, { status: 500 });
  }
}
