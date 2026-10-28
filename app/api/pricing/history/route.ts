import { NextRequest, NextResponse } from 'next/server';
import { queryRows } from '@/lib/db';
import { pricingAuth, pricingError } from '@/lib/pricing/route-auth';
import { optionalUuid } from '@/lib/pricing/rate-input';

export const dynamic = 'force-dynamic';

/**
 * GET /api/pricing/history?party_id=&price_level_id=&item_id=
 * The last 200 changes to customer prices, level rates and category discounts, newest first,
 * narrowed by whichever ids are given.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await pricingAuth(request, 'read');
    if (auth instanceof NextResponse) return auth;
    const sp = new URL(request.url).searchParams;
    const partyId = optionalUuid(sp.get('party_id'), 'party_id');
    const levelId = optionalUuid(sp.get('price_level_id'), 'price_level_id');
    const itemId = optionalUuid(sp.get('item_id'), 'item_id');
    const history = await queryRows(
      `SELECT h.id, h.scope, h.changed_at, h.min_qty::float AS min_qty,
              h.old_price::float AS old_price, h.new_price::float AS new_price,
              h.old_discount_percent::float AS old_discount_percent, h.new_discount_percent::float AS new_discount_percent,
              h.valid_from::text AS valid_from, h.valid_to::text AS valid_to,
              c.name AS customer_name, pl.name AS level_name, i.name AS item_name, v.variant_name,
              cat.name AS category_name, u.name AS changed_by_name
         FROM price_change_log h
         LEFT JOIN customers c ON c.id = h.party_id
         LEFT JOIN price_levels pl ON pl.id = h.price_level_id
         LEFT JOIN items i ON i.id = h.item_id
         LEFT JOIN item_variants v ON v.id = h.variant_id
         LEFT JOIN categories cat ON cat.id = h.category_id
         LEFT JOIN users u ON u.id = h.changed_by
        WHERE h.business_id = $1
          AND ($2::uuid IS NULL OR h.party_id = $2)
          AND ($3::uuid IS NULL OR h.price_level_id = $3)
          AND ($4::uuid IS NULL OR h.item_id = $4)
        ORDER BY h.changed_at DESC
        LIMIT 200`,
      [auth.businessId, partyId, levelId, itemId]
    );
    return NextResponse.json({ history });
  } catch (error) {
    return pricingError(error, 'GET /api/pricing/history');
  }
}
