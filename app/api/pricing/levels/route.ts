import { NextRequest, NextResponse } from 'next/server';
import { getPool, queryOne, queryRows } from '@/lib/db';
import { pricingAuth, pricingError } from '@/lib/pricing/route-auth';
import { inTransaction, optionalUuid, RateInputError } from '@/lib/pricing/rate-input';

export const dynamic = 'force-dynamic';

/** GET /api/pricing/levels → { levels: { id, name, description, is_active, customer_count, rate_count }[] } */
export async function GET(request: NextRequest) {
  try {
    const auth = await pricingAuth(request, 'read');
    if (auth instanceof NextResponse) return auth;
    const levels = await queryRows(
      `SELECT pl.id, pl.name, pl.description, pl.is_active,
              (SELECT COUNT(*)::int FROM customers c WHERE c.price_level_id = pl.id AND c.deleted_at IS NULL) AS customer_count,
              (SELECT COUNT(*)::int FROM price_level_rates r WHERE r.price_level_id = pl.id) AS rate_count
         FROM price_levels pl
        WHERE pl.business_id = $1
        ORDER BY pl.is_active DESC, LOWER(pl.name)`,
      [auth.businessId]
    );
    return NextResponse.json({ levels });
  } catch (error) {
    return pricingError(error, 'GET /api/pricing/levels');
  }
}

/**
 * POST /api/pricing/levels
 * { name, description?, is_active? } creates a level; with `id` it updates that level.
 * { assign: { price_level_id | null, customer_ids: string[] } } puts customers on a level (null takes them off).
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await pricingAuth(request, 'update');
    if (auth instanceof NextResponse) return auth;
    const body = await request.json().catch(() => ({}));

    if (body.assign) {
      const levelId = optionalUuid(body.assign.price_level_id, 'price_level_id');
      const ids: unknown[] = Array.isArray(body.assign.customer_ids) ? body.assign.customer_ids : [];
      if (ids.length === 0 || ids.length > 500) throw new RateInputError('Pick between 1 and 500 customers');
      const customerIds = ids.map((id) => optionalUuid(id, 'customer_id')).filter(Boolean) as string[];
      if (levelId) {
        const level = await queryOne('SELECT id FROM price_levels WHERE id = $1 AND business_id = $2', [levelId, auth.businessId]);
        if (!level) return NextResponse.json({ error: 'Price level not found' }, { status: 404 });
      }
      const updated = await inTransaction(getPool(), async (client) => {
        const r = await client.query(
          `UPDATE customers SET price_level_id = $1, updated_at = CURRENT_TIMESTAMP
            WHERE business_id = $2 AND id = ANY($3::uuid[])`,
          [levelId, auth.businessId, customerIds]
        );
        return r.rowCount ?? 0;
      });
      return NextResponse.json({ ok: true, updated });
    }

    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name || name.length > 100) throw new RateInputError('Give the price level a name (up to 100 characters)');
    const description = typeof body.description === 'string' && body.description.trim() ? body.description.trim() : null;
    const isActive = body.is_active === undefined ? true : !!body.is_active;
    const id = optionalUuid(body.id, 'id');

    if (id) {
      const level = await queryOne(
        `UPDATE price_levels SET name = $1, description = $2, is_active = $3, updated_at = CURRENT_TIMESTAMP
          WHERE id = $4 AND business_id = $5 RETURNING id, name, description, is_active`,
        [name, description, isActive, id, auth.businessId]
      );
      if (!level) return NextResponse.json({ error: 'Price level not found' }, { status: 404 });
      return NextResponse.json({ level });
    }
    const level = await queryOne(
      `INSERT INTO price_levels (business_id, name, description, is_active)
       VALUES ($1, $2, $3, $4) RETURNING id, name, description, is_active`,
      [auth.businessId, name, description, isActive]
    );
    return NextResponse.json({ level }, { status: 201 });
  } catch (error) {
    return pricingError(error, 'POST /api/pricing/levels');
  }
}

/** DELETE /api/pricing/levels?id= removes a level and its rates; its customers go back to item prices. */
export async function DELETE(request: NextRequest) {
  try {
    const auth = await pricingAuth(request, 'update');
    if (auth instanceof NextResponse) return auth;
    const id = optionalUuid(new URL(request.url).searchParams.get('id'), 'id');
    if (!id) throw new RateInputError('id is required');
    const gone = await queryOne('DELETE FROM price_levels WHERE id = $1 AND business_id = $2 RETURNING id', [id, auth.businessId]);
    if (!gone) return NextResponse.json({ error: 'Price level not found' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return pricingError(error, 'DELETE /api/pricing/levels');
  }
}
