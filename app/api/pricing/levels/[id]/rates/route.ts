import { NextRequest, NextResponse } from 'next/server';
import { getPool, queryOne, queryRows } from '@/lib/db';
import { pricingAuth, pricingError } from '@/lib/pricing/route-auth';
import {
  inTransaction,
  isRemoval,
  logPriceChange,
  optionalUuid,
  parseRateFields,
  RateInputError,
  type RateFields,
} from '@/lib/pricing/rate-input';

export const dynamic = 'force-dynamic';

async function levelOf(id: string, businessId: string) {
  return queryOne<{ id: string; name: string }>('SELECT id, name FROM price_levels WHERE id = $1 AND business_id = $2', [id, businessId]);
}

/**
 * GET /api/pricing/levels/[id]/rates
 * → { level, rates: { item_id, variant_id, min_qty, price, discount_percent, valid_from, valid_to }[],
 *     variants (for the item picker), customers (on this level) }
 */
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const auth = await pricingAuth(request, 'read');
    if (auth instanceof NextResponse) return auth;
    const levelId = optionalUuid(params.id, 'price level');
    const level = levelId ? await levelOf(levelId, auth.businessId) : null;
    if (!level) return NextResponse.json({ error: 'Price level not found' }, { status: 404 });
    const rates = await queryRows(
      `SELECT item_id, variant_id, min_qty::float AS min_qty, price::float AS price,
              discount_percent::float AS discount_percent, valid_from::text AS valid_from, valid_to::text AS valid_to
         FROM price_level_rates
        WHERE price_level_id = $1 AND business_id = $2
        ORDER BY item_id, variant_id NULLS FIRST, min_qty, valid_from NULLS FIRST`,
      [levelId, auth.businessId]
    );
    const [variants, customers] = await Promise.all([
      queryRows(
        `SELECT v.id, v.item_id, v.variant_name, v.selling_price::float AS selling_price
           FROM item_variants v JOIN items i ON i.id = v.item_id
          WHERE i.business_id = $1 AND i.has_variants = true AND i.deleted_at IS NULL
          ORDER BY v.item_id, v.variant_name`,
        [auth.businessId]
      ),
      queryRows(
        `SELECT id, name FROM customers WHERE business_id = $1 AND price_level_id = $2 AND deleted_at IS NULL ORDER BY LOWER(name)`,
        [auth.businessId, levelId]
      ),
    ]);
    return NextResponse.json({ level, rates, variants, customers });
  } catch (error) {
    return pricingError(error, 'GET /api/pricing/levels/[id]/rates');
  }
}

/**
 * POST /api/pricing/levels/[id]/rates
 * { rows: { item_id, variant_id?, min_qty?, price?, discount_percent?, valid_from?, valid_to? }[] } (max 300)
 * A rate is identified by item, variant, min_qty and start date; a row with neither price nor
 * discount removes it. Every change is logged.
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const auth = await pricingAuth(request, 'update');
    if (auth instanceof NextResponse) return auth;
    const levelId = optionalUuid(params.id, 'price level');
    const level = levelId ? await levelOf(levelId, auth.businessId) : null;
    if (!level) return NextResponse.json({ error: 'Price level not found' }, { status: 404 });

    const body = await request.json().catch(() => ({}));

    // { adjust_percent: n } raises (or with a negative n lowers) every fixed rate on the level.
    // { fill_from_catalog_percent: n } adds a base rate of item price ± n% for every item that has
    // no base rate on the level yet (variants get one each from their own price).
    if (body.adjust_percent !== undefined || body.fill_from_catalog_percent !== undefined) {
      const isFill = body.fill_from_catalog_percent !== undefined;
      const pct = Number(isFill ? body.fill_from_catalog_percent : body.adjust_percent);
      if (!Number.isFinite(pct) || pct <= -100 || pct > 1000) throw new RateInputError('Enter a percentage above -100');
      const changed = await inTransaction(getPool(), async (client) => {
        const rows = isFill
          ? (
              await client.query(
                `WITH targets AS (
                   SELECT i.id AS item_id, NULL::uuid AS variant_id, i.selling_price AS base
                     FROM items i
                    WHERE i.business_id = $1 AND i.deleted_at IS NULL AND COALESCE(i.has_variants, false) = false
                      AND i.selling_price IS NOT NULL
                   UNION ALL
                   SELECT v.item_id, v.id, v.selling_price
                     FROM item_variants v JOIN items i ON i.id = v.item_id
                    WHERE i.business_id = $1 AND i.deleted_at IS NULL AND v.selling_price IS NOT NULL
                 )
                 INSERT INTO price_level_rates (business_id, price_level_id, item_id, variant_id, min_qty, price)
                 SELECT $1, $2, t.item_id, t.variant_id, 0, ROUND(t.base * (1 + $3::numeric / 100), 2)
                   FROM targets t
                  WHERE NOT EXISTS (
                    SELECT 1 FROM price_level_rates r
                     WHERE r.price_level_id = $2 AND r.item_id = t.item_id
                       AND r.variant_id IS NOT DISTINCT FROM t.variant_id AND r.min_qty = 0 AND r.valid_from IS NULL)
                 RETURNING item_id, variant_id, min_qty::float AS min_qty, NULL::float AS old_price, price::float AS new_price`,
                [auth.businessId, levelId, pct]
              )
            ).rows
          : (
              await client.query(
                `UPDATE price_level_rates r SET price = ROUND(r.price * (1 + $3::numeric / 100), 2), updated_at = CURRENT_TIMESTAMP
                   FROM price_level_rates old
                  WHERE old.id = r.id AND r.business_id = $1 AND r.price_level_id = $2 AND r.price IS NOT NULL
                  RETURNING r.item_id, r.variant_id, r.min_qty::float AS min_qty, old.price::float AS old_price, r.price::float AS new_price`,
                [auth.businessId, levelId, pct]
              )
            ).rows;
        for (const r of rows) {
          await logPriceChange(client, {
            businessId: auth.businessId,
            scope: 'price_level',
            priceLevelId: levelId,
            itemId: r.item_id,
            variantId: r.variant_id,
            minQty: r.min_qty,
            old: r.old_price == null ? null : { price: r.old_price, discount_percent: null },
            next: { price: r.new_price, discount_percent: null, valid_from: null, valid_to: null },
            changedBy: auth.userId,
          });
        }
        return rows.length;
      });
      return NextResponse.json({ ok: true, changed });
    }

    const rows: Record<string, unknown>[] = Array.isArray(body.rows) ? body.rows : [];
    if (rows.length === 0 || rows.length > 300) throw new RateInputError('Send between 1 and 300 rows');

    const parsed: Array<{ itemId: string; variantId: string | null; minQty: number; fields: RateFields }> = [];
    for (const r of rows) {
      const itemId = optionalUuid(r.item_id, 'item_id');
      if (!itemId) throw new RateInputError('item_id is required');
      const minQty = r.min_qty == null || r.min_qty === '' ? 0 : Number(r.min_qty);
      if (!Number.isFinite(minQty) || minQty < 0) throw new RateInputError('Invalid minimum quantity');
      parsed.push({ itemId, variantId: optionalUuid(r.variant_id, 'variant_id'), minQty, fields: parseRateFields(r) });
    }

    const itemIds = [...new Set(parsed.map((p) => p.itemId))];
    const found = new Set(
      (await queryRows<{ id: string }>('SELECT id FROM items WHERE business_id = $1 AND id = ANY($2::uuid[])', [auth.businessId, itemIds])).map(
        (r) => r.id
      )
    );
    const missing = itemIds.find((id) => !found.has(id));
    if (missing) return NextResponse.json({ error: `Item not found: ${missing}` }, { status: 404 });
    const withVariant = parsed.filter((p) => p.variantId);
    if (withVariant.length) {
      const ok = new Set(
        (
          await queryRows<{ id: string; item_id: string }>('SELECT id, item_id FROM item_variants WHERE id = ANY($1::uuid[])', [
            withVariant.map((p) => p.variantId),
          ])
        ).map((r) => `${r.item_id}:${r.id}`)
      );
      const bad = withVariant.find((p) => !ok.has(`${p.itemId}:${p.variantId}`));
      if (bad) return NextResponse.json({ error: `Variant not found: ${bad.variantId}` }, { status: 404 });
    }

    await inTransaction(getPool(), async (client) => {
      for (const p of parsed) {
        const key = [levelId, p.itemId, p.variantId, p.minQty, p.fields.valid_from];
        const keyWhere = `price_level_id = $1 AND item_id = $2 AND variant_id IS NOT DISTINCT FROM $3::uuid
                          AND min_qty = $4 AND valid_from IS NOT DISTINCT FROM $5::date`;
        const old =
          (
            await client.query(
              `SELECT price::float AS price, discount_percent::float AS discount_percent FROM price_level_rates WHERE ${keyWhere} FOR UPDATE`,
              key
            )
          ).rows[0] ?? null;
        await client.query(`DELETE FROM price_level_rates WHERE ${keyWhere}`, key);
        if (!isRemoval(p.fields)) {
          await client.query(
            `INSERT INTO price_level_rates
               (business_id, price_level_id, item_id, variant_id, min_qty, price, discount_percent, valid_from, valid_to)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
              auth.businessId,
              levelId,
              p.itemId,
              p.variantId,
              p.minQty,
              p.fields.price,
              p.fields.discount_percent,
              p.fields.valid_from,
              p.fields.valid_to,
            ]
          );
        }
        await logPriceChange(client, {
          businessId: auth.businessId,
          scope: 'price_level',
          priceLevelId: levelId,
          itemId: p.itemId,
          variantId: p.variantId,
          minQty: p.minQty,
          old,
          next: isRemoval(p.fields) ? null : p.fields,
          changedBy: auth.userId,
        });
      }
    });
    return NextResponse.json({ ok: true, saved: parsed.length });
  } catch (error) {
    return pricingError(error, 'POST /api/pricing/levels/[id]/rates');
  }
}
