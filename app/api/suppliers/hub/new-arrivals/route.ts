import { NextRequest, NextResponse } from 'next/server';
import * as db from '@/lib/db';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { requireAuthenticatedTenant } from '@/lib/stock-request-security';

export const dynamic = 'force-dynamic';

const LISTING_SQL = `
  SELECT l.id AS listing_id, l.item_id AS vendor_item_id, l.collection_id,
         COALESCE(NULLIF(l.display_name, ''), i.name) AS name, i.unit,
         COALESCE(l.image_url, i.image_url) AS image_url,
         l.price, l.moq, l.order_multiple, l.pack_label, l.lead_time_text,
         bi.id AS my_item_id, bi.name AS my_item_name
  FROM supplier_published_listings l
  JOIN items i ON i.id = l.item_id AND i.business_id = l.supplier_business_id AND i.deleted_at IS NULL
  LEFT JOIN supplier_item_links sil
    ON sil.vendor_item_id = l.item_id AND sil.vendor_business_id = l.supplier_business_id AND sil.buyer_business_id = $1
  LEFT JOIN items bi ON bi.id = sil.buyer_item_id AND bi.deleted_at IS NULL
  WHERE l.is_active = true
`;

/**
 * GET /api/suppliers/hub/new-arrivals?supplier_id=
 * For the buyer: published collections from connected suppliers (newest first, last 180 days),
 * each with its items, the buyer's price, MOQ and pack. With supplier_id (the buyer's own
 * supplier record) it also returns that supplier's other catalog items.
 */
export async function GET(request: NextRequest) {
  const auth = requireAuthenticatedTenant(request);
  if (auth instanceof NextResponse) return auth;
  try {
    await authorize(auth.userId, 'purchases', 'read', { businessId: auth.businessId });
    const supplierId = new URL(request.url).searchParams.get('supplier_id');

    const suppliers = await db.queryRows<{
      supplier_id: string;
      business_id: string;
      name: string;
      mute_launches: boolean;
    }>(
      `SELECT DISTINCT ON (s.linked_business_id)
              s.id AS supplier_id, s.linked_business_id AS business_id, b.name, s.mute_launches
         FROM suppliers s
         JOIN businesses b ON b.id = s.linked_business_id
        WHERE s.business_id = $1 AND s.linked_business_id IS NOT NULL
          AND s.approval_status = 'approved' AND s.deleted_at IS NULL
        ORDER BY s.linked_business_id, s.approved_at DESC NULLS LAST`,
      [auth.businessId]
    );
    const scoped = supplierId ? suppliers.filter((s) => s.supplier_id === supplierId) : suppliers;
    if (supplierId && scoped.length === 0) {
      return NextResponse.json({ error: 'Not a connected supplier of yours' }, { status: 404 });
    }
    const vendorIds = scoped.map((s) => s.business_id);
    if (vendorIds.length === 0) return NextResponse.json({ suppliers, collections: [], catalog: [] });

    const collections = await db.queryRows(
      `SELECT c.id, c.supplier_business_id, c.name, c.season, c.description, c.cover_image_url, c.published_at
         FROM supplier_collections c
        WHERE c.supplier_business_id = ANY($1::uuid[])
          AND c.status = 'published'
          AND c.published_at >= CURRENT_TIMESTAMP - INTERVAL '180 days'
        ORDER BY c.published_at DESC
        LIMIT 40`,
      [vendorIds]
    );
    const listings = collections.length
      ? await db.queryRows(`${LISTING_SQL} AND l.collection_id = ANY($2::uuid[]) ORDER BY l.sort_order, l.created_at`, [
          auth.businessId,
          collections.map((c: any) => c.id),
        ])
      : [];
    const catalog = supplierId
      ? await db.queryRows(
          `${LISTING_SQL} AND l.supplier_business_id = $2
             AND (l.collection_id IS NULL OR NOT EXISTS (
               SELECT 1 FROM supplier_collections c WHERE c.id = l.collection_id AND c.status = 'published'))
           ORDER BY l.sort_order, l.created_at`,
          [auth.businessId, vendorIds[0]]
        )
      : [];

    const supplierOf = new Map(suppliers.map((s) => [s.business_id, s]));
    return NextResponse.json({
      suppliers,
      collections: collections.map((c: any) => ({
        ...c,
        supplier_id: supplierOf.get(c.supplier_business_id)?.supplier_id,
        supplier_name: supplierOf.get(c.supplier_business_id)?.name,
        items: listings.filter((l: any) => l.collection_id === c.id),
      })),
      catalog,
    });
  } catch (error) {
    if (error instanceof AuthorizationError) return error.toNextResponse();
    console.error('new-arrivals GET', error);
    return NextResponse.json({ error: 'Failed to load new arrivals' }, { status: 500 });
  }
}
