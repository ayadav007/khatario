import { NextRequest, NextResponse } from 'next/server';
import { queryOne, queryRows } from '@/lib/db';
import { pricingAuth, pricingError } from '@/lib/pricing/route-auth';
import { optionalUuid, parseRateFields, RateInputError } from '@/lib/pricing/rate-input';

export const dynamic = 'force-dynamic';

/** GET /api/pricing/schemes → { schemes } with item, variant and level names, and { variants } for the picker. */
export async function GET(request: NextRequest) {
  try {
    const auth = await pricingAuth(request, 'read');
    if (auth instanceof NextResponse) return auth;
    const schemes = await queryRows(
      `SELECT s.id, s.item_id, s.variant_id, s.price_level_id, s.buy_qty::float AS buy_qty, s.free_qty::float AS free_qty,
              s.valid_from::text AS valid_from, s.valid_to::text AS valid_to, s.is_active,
              i.name AS item_name, v.variant_name, pl.name AS level_name
         FROM item_schemes s
         JOIN items i ON i.id = s.item_id
         LEFT JOIN item_variants v ON v.id = s.variant_id
         LEFT JOIN price_levels pl ON pl.id = s.price_level_id
        WHERE s.business_id = $1
        ORDER BY s.is_active DESC, LOWER(i.name), v.variant_name NULLS FIRST`,
      [auth.businessId]
    );
    const variants = await queryRows(
      `SELECT v.id, v.item_id, v.variant_name
         FROM item_variants v JOIN items i ON i.id = v.item_id
        WHERE i.business_id = $1 AND i.has_variants = true AND i.deleted_at IS NULL
        ORDER BY v.item_id, v.variant_name`,
      [auth.businessId]
    );
    return NextResponse.json({ schemes, variants });
  } catch (error) {
    return pricingError(error, 'GET /api/pricing/schemes');
  }
}

/**
 * POST /api/pricing/schemes
 * { id?, item_id, variant_id?, price_level_id?, buy_qty, free_qty, valid_from?, valid_to?, is_active? }
 * Creates a scheme, or updates the one with `id`.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await pricingAuth(request, 'update');
    if (auth instanceof NextResponse) return auth;
    const body = await request.json().catch(() => ({}));
    const id = optionalUuid(body.id, 'id');
    const itemId = optionalUuid(body.item_id, 'item_id');
    if (!itemId) throw new RateInputError('Pick an item');
    const variantId = optionalUuid(body.variant_id, 'variant_id');
    const levelId = optionalUuid(body.price_level_id, 'price_level_id');
    const buy = Number(body.buy_qty);
    const free = Number(body.free_qty);
    if (!(buy > 0) || !(free > 0)) throw new RateInputError('Buy and free quantities must be more than 0');
    const { valid_from, valid_to } = parseRateFields({ valid_from: body.valid_from, valid_to: body.valid_to });
    const isActive = body.is_active === undefined ? true : !!body.is_active;

    const item = await queryOne('SELECT id FROM items WHERE id = $1 AND business_id = $2', [itemId, auth.businessId]);
    if (!item) return NextResponse.json({ error: 'Item not found' }, { status: 404 });
    if (variantId && !(await queryOne('SELECT id FROM item_variants WHERE id = $1 AND item_id = $2', [variantId, itemId]))) {
      return NextResponse.json({ error: 'Variant not found' }, { status: 404 });
    }
    if (levelId && !(await queryOne('SELECT id FROM price_levels WHERE id = $1 AND business_id = $2', [levelId, auth.businessId]))) {
      return NextResponse.json({ error: 'Price level not found' }, { status: 404 });
    }

    const params = [auth.businessId, itemId, variantId, levelId, buy, free, valid_from, valid_to, isActive];
    if (id) {
      const updated = await queryOne(
        `UPDATE item_schemes SET item_id = $2, variant_id = $3, price_level_id = $4, buy_qty = $5, free_qty = $6,
                valid_from = $7, valid_to = $8, is_active = $9, updated_at = CURRENT_TIMESTAMP
          WHERE id = $10 AND business_id = $1 RETURNING id`,
        [...params, id]
      );
      if (!updated) return NextResponse.json({ error: 'Scheme not found' }, { status: 404 });
      return NextResponse.json({ ok: true, id });
    }
    const created = await queryOne(
      `INSERT INTO item_schemes (business_id, item_id, variant_id, price_level_id, buy_qty, free_qty, valid_from, valid_to, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      params
    );
    return NextResponse.json({ ok: true, id: created?.id }, { status: 201 });
  } catch (error) {
    return pricingError(error, 'POST /api/pricing/schemes');
  }
}

/** DELETE /api/pricing/schemes?id= */
export async function DELETE(request: NextRequest) {
  try {
    const auth = await pricingAuth(request, 'update');
    if (auth instanceof NextResponse) return auth;
    const id = optionalUuid(new URL(request.url).searchParams.get('id'), 'id');
    if (!id) throw new RateInputError('id is required');
    const gone = await queryOne('DELETE FROM item_schemes WHERE id = $1 AND business_id = $2 RETURNING id', [id, auth.businessId]);
    if (!gone) return NextResponse.json({ error: 'Scheme not found' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return pricingError(error, 'DELETE /api/pricing/schemes');
  }
}
