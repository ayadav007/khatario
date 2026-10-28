import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne, queryRows } from '@/lib/db';
import { getPool } from '@/lib/db';
import { getSessionScopedBusinessId, getUserIdFromRequest } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { assertFeatureAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { FeatureKeys } from '@/lib/featureKeys';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Exec = (sql: string, params: unknown[]) => Promise<unknown>;

/** Save or (price null) remove one override. Variant rows and whole-item rows have separate unique indexes. */
async function writeOverride(
  exec: Exec,
  businessId: string,
  partyId: string,
  itemId: string,
  variantId: string | null,
  price: number | null
) {
  if (price === null) {
    await exec(
      `DELETE FROM party_item_prices
       WHERE business_id = $1 AND party_id = $2 AND item_id = $3 AND variant_id IS NOT DISTINCT FROM $4::uuid`,
      [businessId, partyId, itemId, variantId]
    );
    return;
  }
  if (variantId) {
    await exec(
      `INSERT INTO party_item_prices (business_id, party_id, item_id, variant_id, price)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (business_id, party_id, item_id, variant_id) WHERE variant_id IS NOT NULL
       DO UPDATE SET price = EXCLUDED.price`,
      [businessId, partyId, itemId, variantId, price]
    );
    return;
  }
  await exec(
    `INSERT INTO party_item_prices (business_id, party_id, item_id, price)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (business_id, party_id, item_id) WHERE variant_id IS NULL
     DO UPDATE SET price = EXCLUDED.price`,
    [businessId, partyId, itemId, price]
  );
}

/** '' or missing means the whole item; a UUID means that variant; anything else is 'invalid'. */
function parseVariantId(raw: unknown): string | null | 'invalid' {
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw !== 'string' || !UUID_RE.test(raw.trim())) return 'invalid';
  return raw.trim();
}

/**
 * GET /api/pricing/party-item
 * - ?party_id=&item_id=[&variant_id=]  → { price: number | null } (single lookup; a variant
 *   without its own price falls back to the whole-item price)
 * - ?party_id=          → { overrides: { item_id, variant_id, price }[] } (all overrides for party)
 */
export async function GET(request: NextRequest) {
  try {
    const userId = getUserIdFromRequest(request);
    if (!userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const businessId = getSessionScopedBusinessId(request);
    if (!businessId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    try {
      await assertFeatureAccess(businessId, FeatureKeys.PARTY_PRICING);
    } catch (error) {
      if (error instanceof FeatureAccessDeniedError) {
        return error.toNextResponse();
      }
      throw error;
    }

    const { searchParams } = new URL(request.url);
    const partyId = searchParams.get('party_id');
    const itemId = searchParams.get('item_id');
    const variantId = parseVariantId(searchParams.get('variant_id'));

    if (!partyId?.trim()) {
      return NextResponse.json({ error: 'party_id is required' }, { status: 400 });
    }
    if (variantId === 'invalid') {
      return NextResponse.json({ error: 'Invalid variant_id' }, { status: 400 });
    }

    try {
      await authorize(userId, 'items', 'read', { businessId });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    const pid = partyId.trim();

    if (!itemId?.trim()) {
      const cust = await queryOne<{ id: string }>(
        'SELECT id FROM customers WHERE id = $1 AND business_id = $2',
        [pid, businessId]
      );
      if (!cust) {
        return NextResponse.json({ error: 'Customer not found' }, { status: 404 });
      }

      const rows = await queryRows<{ item_id: string; variant_id: string | null; price: string | number }>(
        `SELECT item_id, variant_id, price
         FROM party_item_prices
         WHERE business_id = $1 AND party_id = $2
         ORDER BY item_id, variant_id NULLS FIRST`,
        [businessId, pid]
      );

      const overrides = rows.map((r) => ({
        item_id: r.item_id,
        variant_id: r.variant_id,
        price: Number(r.price),
      }));

      // The setup screen shows one row per variant, and the items list does not carry them.
      const variantRows = await queryRows<{ id: string; item_id: string; variant_name: string; selling_price: string | null }>(
        `SELECT v.id, v.item_id, v.variant_name, v.selling_price
         FROM item_variants v
         JOIN items i ON i.id = v.item_id
         WHERE i.business_id = $1 AND i.has_variants = true AND i.deleted_at IS NULL
         ORDER BY v.item_id, v.variant_name`,
        [businessId]
      );
      const variants = variantRows.map((v) => ({
        id: v.id,
        item_id: v.item_id,
        variant_name: v.variant_name,
        selling_price: v.selling_price == null ? null : Number(v.selling_price),
      }));

      return NextResponse.json({ overrides, variants });
    }

    const row = await queryOne<{ price: string | number | null }>(
      `SELECT price
       FROM party_item_prices
       WHERE business_id = $1
         AND party_id = $2
         AND item_id = $3
         AND (variant_id IS NULL OR variant_id = $4::uuid)
       ORDER BY variant_id NULLS LAST
       LIMIT 1`,
      [businessId, pid, itemId.trim(), variantId]
    );

    let price: number | null = null;
    if (row?.price != null && row.price !== '') {
      const n = typeof row.price === 'number' ? row.price : Number(row.price);
      price = Number.isFinite(n) ? n : null;
    }

    return NextResponse.json({ price });
  } catch (error: unknown) {
    console.error('[GET /api/pricing/party-item]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

type RowInput = { item_id: string; variant_id?: string | null; price: number | null };

/**
 * POST /api/pricing/party-item
 * Body (single): { party_id, item_id, variant_id?, price: number | null }
 * Body (bulk):   { party_id, rows: RowInput[] }  (max 300 rows)
 * price null removes the override for that item (or that variant).
 */
export async function POST(request: NextRequest) {
  try {
    const userId = getUserIdFromRequest(request);
    if (!userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const businessId = getSessionScopedBusinessId(request);
    if (!businessId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const partyId = typeof body.party_id === 'string' ? body.party_id.trim() : '';
    if (!partyId) {
      return NextResponse.json({ error: 'party_id is required' }, { status: 400 });
    }

    try {
      await authorize(userId, 'items', 'update', { businessId });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    try {
      await assertFeatureAccess(businessId, FeatureKeys.PARTY_PRICING);
    } catch (error) {
      if (error instanceof FeatureAccessDeniedError) {
        return error.toNextResponse();
      }
      throw error;
    }

    const cust = await queryOne<{ id: string }>(
      'SELECT id FROM customers WHERE id = $1 AND business_id = $2',
      [partyId, businessId]
    );
    if (!cust) {
      return NextResponse.json({ error: 'Customer not found' }, { status: 404 });
    }

    const bulkRows: RowInput[] | null = Array.isArray(body.rows) ? body.rows : null;
    if (bulkRows) {
      if (bulkRows.length > 300) {
        return NextResponse.json({ error: 'Too many rows (max 300)' }, { status: 400 });
      }
      const pool = getPool();
      const client = await pool.connect();
      let saved = 0;
      try {
        await client.query('BEGIN');
        for (const r of bulkRows) {
          const iid = typeof r.item_id === 'string' ? r.item_id.trim() : '';
          if (!iid) continue;
          const vid = parseVariantId(r.variant_id);
          if (vid === 'invalid') {
            await client.query('ROLLBACK');
            return NextResponse.json({ error: 'Invalid variant_id for item ' + iid }, { status: 400 });
          }
          const itemOk = await client.query(
            'SELECT id FROM items WHERE id = $1 AND business_id = $2',
            [iid, businessId]
          );
          if (itemOk.rowCount === 0) {
            await client.query('ROLLBACK');
            return NextResponse.json({ error: `Item not found: ${iid}` }, { status: 404 });
          }
          if (vid) {
            const variantOk = await client.query('SELECT id FROM item_variants WHERE id = $1 AND item_id = $2', [vid, iid]);
            if (variantOk.rowCount === 0) {
              await client.query('ROLLBACK');
              return NextResponse.json({ error: `Variant not found: ${vid}` }, { status: 404 });
            }
          }

          let p: number | null = null;
          if (r.price !== null && r.price !== undefined) {
            p = typeof r.price === 'number' ? r.price : Number(r.price);
            if (!Number.isFinite(p) || p < 0) {
              await client.query('ROLLBACK');
              return NextResponse.json({ error: 'Invalid price for item ' + iid }, { status: 400 });
            }
          }

          await writeOverride((sql, params) => client.query(sql, params), businessId, partyId, iid, vid, p);
          saved += 1;
        }
        await client.query('COMMIT');
      } catch (e) {
        try {
          await client.query('ROLLBACK');
        } catch (_) {
          /* ignore */
        }
        throw e;
      } finally {
        client.release();
      }
      return NextResponse.json({ ok: true, saved });
    }

    const itemPk = typeof body.item_id === 'string' ? body.item_id.trim() : '';
    if (!itemPk) {
      return NextResponse.json({ error: 'item_id is required for single save' }, { status: 400 });
    }

    const variantPk = parseVariantId(body.variant_id);
    if (variantPk === 'invalid') {
      return NextResponse.json({ error: 'Invalid variant_id' }, { status: 400 });
    }

    const itemOk = await queryOne(
      'SELECT id FROM items WHERE id = $1 AND business_id = $2',
      [itemPk, businessId]
    );
    if (!itemOk) {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 });
    }
    if (variantPk) {
      const variantOk = await queryOne('SELECT id FROM item_variants WHERE id = $1 AND item_id = $2', [variantPk, itemPk]);
      if (!variantOk) {
        return NextResponse.json({ error: 'Variant not found' }, { status: 404 });
      }
    }

    let p: number | null = null;
    if (body.price !== null && body.price !== '') {
      const n = typeof body.price === 'number' ? body.price : Number(body.price);
      if (!Number.isFinite(n) || n < 0) {
        return NextResponse.json({ error: 'Invalid price' }, { status: 400 });
      }
      p = n;
    }

    await writeOverride((sql, params) => query(sql, params as any[]), businessId, partyId, itemPk, variantPk, p);

    return NextResponse.json({ ok: true, saved: 1 });
  } catch (error: unknown) {
    console.error('[POST /api/pricing/party-item]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
