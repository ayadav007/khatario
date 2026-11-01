import { NextRequest, NextResponse } from 'next/server';
import * as db from '@/lib/db';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { requireAuthenticatedTenant } from '@/lib/stock-request-security';
import { DISTRICT_SQL, trustForBusinesses } from '@/lib/supplier-trust';

export const dynamic = 'force-dynamic';

const SORTS: Record<string, string> = {
  name: 'b.name ASC',
  most_connected: 'buyers_count DESC, b.name ASC',
  newest: 'd.created_at DESC, b.name ASC',
};

/**
 * GET /api/suppliers/hub/directory?q=&category=&district=&has_catalogue=1&shows_prices=1&gst_verified=1&sort=&page=
 * Lists businesses opted into directory search (excludes current business), each with
 * whether the signed-in business is already connected to it or has asked to be, how many
 * shops buy from it on Khatario, the first three items of its public catalogue, and its trust
 * signals (GST verified, district, fill rate, typical reply; see lib/supplier-trust).
 * `q` matches name, place, GSTIN, categories and the names/brands of public listings.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = requireAuthenticatedTenant(request);
    if (auth instanceof NextResponse) return auth;
    const { businessId, userId } = auth;
    try {
      await authorize(userId, 'purchases', 'read', { businessId });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    const { searchParams } = new URL(request.url);
    const q = (searchParams.get('q') || '').trim();
    const category = (searchParams.get('category') || '').trim();
    const hasCatalogue = searchParams.get('has_catalogue') === '1';
    const showsPrices = searchParams.get('shows_prices') === '1';
    const district = (searchParams.get('district') || '').trim();
    const gstVerified = searchParams.get('gst_verified') === '1';
    const orderBy = SORTS[searchParams.get('sort') || ''] || SORTS.name;
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') || '20', 10)));
    const offset = (page - 1) * limit;

    const term = q ? `%${q}%` : '%';
    const where = `
      d.visibility = 'directory'
      AND d.directory_approved = true
      AND b.id <> $1
      AND (
        $2::text = '%'
        OR b.name ILIKE $2
        OR COALESCE(b.city, '') ILIKE $2
        OR COALESCE(b.state, '') ILIKE $2
        OR COALESCE(d.gst_district, '') ILIKE $2
        OR COALESCE(b.gstin, '') ILIKE $2
        OR EXISTS (SELECT 1 FROM unnest(d.featured_categories) c WHERE c ILIKE $2)
        OR EXISTS (
          SELECT 1 FROM supplier_published_listings l
          INNER JOIN items i ON i.id = l.item_id AND i.business_id = l.supplier_business_id AND i.deleted_at IS NULL
          WHERE l.supplier_business_id = b.id AND l.is_active = true AND l.audience = 'public_preview'
            AND (COALESCE(l.display_name, i.name) ILIKE $2 OR COALESCE(i.brand, '') ILIKE $2)
        )
      )
      AND ($3::text = '' OR EXISTS (SELECT 1 FROM unnest(d.featured_categories) c WHERE lower(c) = lower($3)))
      AND (NOT $4::boolean OR EXISTS (
        SELECT 1 FROM supplier_published_listings l
        WHERE l.supplier_business_id = b.id AND l.is_active = true AND l.audience = 'public_preview'
      ))
      AND (NOT $5::boolean OR EXISTS (
        SELECT 1 FROM supplier_published_listings l
        WHERE l.supplier_business_id = b.id AND l.is_active = true AND l.audience = 'public_preview'
          AND l.price_display = 'from_amount' AND l.from_amount IS NOT NULL
      ))
      AND ($6::text = '' OR lower(${DISTRICT_SQL}) = lower($6))
      AND (NOT $7::boolean OR (
        d.gst_verified_gstin = UPPER(b.gstin) AND lower(TRIM(COALESCE(d.gst_status, ''))) = 'active'
      ))
    `;
    const filterParams = [businessId, term, category, hasCatalogue, showsPrices, district, gstVerified];

    const rows = await db.queryRows<{
      id: string;
      name: string;
      city: string | null;
      state: string | null;
      gstin: string | null;
      logo_url: string | null;
      profile_summary: string | null;
      featured_categories: string[] | null;
      connection: 'connected' | 'requested' | null;
      buyers_count: number;
      listing_count: number;
      preview_items: Array<{ name: string; image_url: string | null }>;
    }>(
      `
      SELECT b.id, b.name, b.city, b.state, b.gstin, b.logo_url,
             d.profile_summary, d.featured_categories,
             CASE
               WHEN EXISTS (
                 SELECT 1 FROM suppliers s
                 WHERE s.business_id = $1 AND s.linked_business_id = b.id
                   AND s.approval_status = 'approved' AND s.deleted_at IS NULL
               ) THEN 'connected'
               WHEN EXISTS (
                 SELECT 1 FROM supplier_connection_requests r
                 WHERE r.buyer_business_id = $1 AND r.supplier_business_id = b.id AND r.status = 'pending'
               ) THEN 'requested'
             END AS connection,
             (
               SELECT COUNT(DISTINCT s.business_id)::int FROM suppliers s
               WHERE s.linked_business_id = b.id AND s.approval_status = 'approved'
                 AND s.is_active = true AND s.deleted_at IS NULL
             ) AS buyers_count,
             (
               SELECT COUNT(*)::int FROM supplier_published_listings l
               INNER JOIN items i ON i.id = l.item_id AND i.business_id = l.supplier_business_id AND i.deleted_at IS NULL
               WHERE l.supplier_business_id = b.id AND l.is_active = true AND l.audience = 'public_preview'
             ) AS listing_count,
             COALESCE((
               SELECT json_agg(p) FROM (
                 SELECT COALESCE(l.display_name, i.name) AS name, i.image_url
                 FROM supplier_published_listings l
                 INNER JOIN items i ON i.id = l.item_id AND i.business_id = l.supplier_business_id AND i.deleted_at IS NULL
                 WHERE l.supplier_business_id = b.id AND l.is_active = true AND l.audience = 'public_preview'
                 ORDER BY l.sort_order ASC, l.created_at ASC
                 LIMIT 3
               ) p
             ), '[]'::json) AS preview_items
      FROM businesses b
      INNER JOIN business_discovery d ON d.business_id = b.id
      WHERE ${where}
      ORDER BY ${orderBy}
      LIMIT $8 OFFSET $9
      `,
      [...filterParams, limit, offset]
    );
    const trust = await trustForBusinesses(rows.map((r) => r.id));

    const countRow = await db.queryOne<{ n: string }>(
      `
      SELECT COUNT(*)::text AS n
      FROM businesses b
      INNER JOIN business_discovery d ON d.business_id = b.id
      WHERE ${where}
      `,
      filterParams
    );
    const total = parseInt(countRow?.n || '0', 10);

    // Category chips: the categories listed suppliers actually picked, most common first.
    const categories = await db.queryRows<{ name: string }>(
      `
      SELECT min(c) AS name
      FROM business_discovery d
      CROSS JOIN LATERAL unnest(d.featured_categories) c
      WHERE d.visibility = 'directory' AND d.directory_approved = true AND d.business_id <> $1
      GROUP BY lower(c)
      ORDER BY COUNT(*) DESC, min(c) ASC
      LIMIT 12
      `,
      [businessId]
    );

    // District choices: where listed suppliers are, most suppliers first.
    const districts = await db.queryRows<{ name: string }>(
      `
      SELECT min(${DISTRICT_SQL}) AS name
      FROM business_discovery d
      INNER JOIN businesses b ON b.id = d.business_id
      WHERE d.visibility = 'directory' AND d.directory_approved = true AND d.business_id <> $1
        AND ${DISTRICT_SQL} IS NOT NULL
      GROUP BY lower(${DISTRICT_SQL})
      ORDER BY COUNT(*) DESC, min(${DISTRICT_SQL}) ASC
      LIMIT 40
      `,
      [businessId]
    );

    return NextResponse.json({
      businesses: rows.map((r) => ({ ...r, trust: trust.get(r.id) ?? null })),
      categories: categories.map((c) => c.name),
      districts: districts.map((d) => d.name),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 0 },
    });
  } catch (e: any) {
    console.error('hub directory GET', e);
    return NextResponse.json({ error: e.message || 'Failed' }, { status: 500 });
  }
}
