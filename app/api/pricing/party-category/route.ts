import { NextRequest, NextResponse } from 'next/server';
import { getPool, queryOne, queryRows } from '@/lib/db';
import { pricingAuth, pricingError } from '@/lib/pricing/route-auth';
import { inTransaction, logPriceChange, optionalUuid, parseRateFields, RateInputError } from '@/lib/pricing/rate-input';

export const dynamic = 'force-dynamic';

async function customerOf(id: string | null, businessId: string) {
  if (!id) return null;
  return queryOne('SELECT id FROM customers WHERE id = $1 AND business_id = $2', [id, businessId]);
}

/** GET /api/pricing/party-category?party_id= → { discounts, categories } */
export async function GET(request: NextRequest) {
  try {
    const auth = await pricingAuth(request, 'read');
    if (auth instanceof NextResponse) return auth;
    const partyId = optionalUuid(new URL(request.url).searchParams.get('party_id'), 'party_id');
    if (!(await customerOf(partyId, auth.businessId))) return NextResponse.json({ error: 'Customer not found' }, { status: 404 });
    const [discounts, categories] = await Promise.all([
      queryRows(
        `SELECT category_id, discount_percent::float AS discount_percent, valid_from::text AS valid_from, valid_to::text AS valid_to
           FROM party_category_discounts WHERE business_id = $1 AND party_id = $2`,
        [auth.businessId, partyId]
      ),
      queryRows(`SELECT id, name FROM categories WHERE business_id = $1 ORDER BY LOWER(name)`, [auth.businessId]),
    ]);
    return NextResponse.json({ discounts, categories });
  } catch (error) {
    return pricingError(error, 'GET /api/pricing/party-category');
  }
}

/**
 * POST /api/pricing/party-category
 * { party_id, rows: { category_id, discount_percent | null, valid_from?, valid_to? }[] }
 * A null discount removes it. Every change is logged.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await pricingAuth(request, 'update');
    if (auth instanceof NextResponse) return auth;
    const body = await request.json().catch(() => ({}));
    const partyId = optionalUuid(body.party_id, 'party_id');
    if (!(await customerOf(partyId, auth.businessId))) return NextResponse.json({ error: 'Customer not found' }, { status: 404 });
    const rows: Record<string, unknown>[] = Array.isArray(body.rows) ? body.rows : [];
    if (rows.length === 0 || rows.length > 300) throw new RateInputError('Send between 1 and 300 rows');

    const parsed = rows.map((r) => {
      const categoryId = optionalUuid(r.category_id, 'category_id');
      if (!categoryId) throw new RateInputError('category_id is required');
      const fields = parseRateFields({ ...r, price: null });
      return { categoryId, fields };
    });
    const catIds = [...new Set(parsed.map((p) => p.categoryId))];
    const found = new Set(
      (await queryRows<{ id: string }>('SELECT id FROM categories WHERE business_id = $1 AND id = ANY($2::uuid[])', [auth.businessId, catIds])).map(
        (r) => r.id
      )
    );
    const missing = catIds.find((id) => !found.has(id));
    if (missing) return NextResponse.json({ error: `Category not found: ${missing}` }, { status: 404 });

    await inTransaction(getPool(), async (client) => {
      for (const p of parsed) {
        const old =
          (
            await client.query(
              `SELECT NULL::float AS price, discount_percent::float AS discount_percent FROM party_category_discounts
                WHERE business_id = $1 AND party_id = $2 AND category_id = $3 FOR UPDATE`,
              [auth.businessId, partyId, p.categoryId]
            )
          ).rows[0] ?? null;
        if (p.fields.discount_percent == null) {
          await client.query(`DELETE FROM party_category_discounts WHERE business_id = $1 AND party_id = $2 AND category_id = $3`, [
            auth.businessId,
            partyId,
            p.categoryId,
          ]);
        } else {
          await client.query(
            `INSERT INTO party_category_discounts (business_id, party_id, category_id, discount_percent, valid_from, valid_to)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (business_id, party_id, category_id)
             DO UPDATE SET discount_percent = EXCLUDED.discount_percent, valid_from = EXCLUDED.valid_from,
                           valid_to = EXCLUDED.valid_to, updated_at = CURRENT_TIMESTAMP`,
            [auth.businessId, partyId, p.categoryId, p.fields.discount_percent, p.fields.valid_from, p.fields.valid_to]
          );
        }
        await logPriceChange(client, {
          businessId: auth.businessId,
          scope: 'party_category',
          partyId,
          categoryId: p.categoryId,
          old,
          next: p.fields.discount_percent == null ? null : p.fields,
          changedBy: auth.userId,
        });
      }
    });
    return NextResponse.json({ ok: true, saved: parsed.length });
  } catch (error) {
    return pricingError(error, 'POST /api/pricing/party-category');
  }
}
