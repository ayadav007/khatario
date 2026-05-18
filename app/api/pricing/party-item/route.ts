import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne, queryRows } from '@/lib/db';
import { getPool } from '@/lib/db';
import { getSessionScopedBusinessId, getUserIdFromRequest } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { assertFeatureAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { FeatureKeys } from '@/lib/featureKeys';

/**
 * GET /api/pricing/party-item
 * - ?party_id=&item_id=  → { price: number | null } (single lookup)
 * - ?party_id=          → { overrides: { item_id, price }[] } (all overrides for party)
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

    if (!partyId?.trim()) {
      return NextResponse.json({ error: 'party_id is required' }, { status: 400 });
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

      const rows = await queryRows<{ item_id: string; price: string | number }>(
        `SELECT item_id, price
         FROM party_item_prices
         WHERE business_id = $1 AND party_id = $2
         ORDER BY item_id`,
        [businessId, pid]
      );

      const overrides = rows.map((r) => ({
        item_id: r.item_id,
        price: Number(r.price),
      }));

      return NextResponse.json({ overrides });
    }

    const row = await queryOne<{ price: string | number | null }>(
      `SELECT price
       FROM party_item_prices
       WHERE business_id = $1
         AND party_id = $2
         AND item_id = $3
       LIMIT 1`,
      [businessId, pid, itemId.trim()]
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

type RowInput = { item_id: string; price: number | null };

/**
 * POST /api/pricing/party-item
 * Body (single): { party_id, item_id, price: number | null }
 * Body (bulk):   { party_id, rows: RowInput[] }  (max 300 rows)
 * price null removes the override for that item.
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
          const itemOk = await client.query(
            'SELECT id FROM items WHERE id = $1 AND business_id = $2',
            [iid, businessId]
          );
          if (itemOk.rowCount === 0) {
            await client.query('ROLLBACK');
            return NextResponse.json({ error: `Item not found: ${iid}` }, { status: 404 });
          }

          if (r.price === null || r.price === undefined) {
            await client.query(
              `DELETE FROM party_item_prices
               WHERE business_id = $1 AND party_id = $2 AND item_id = $3`,
              [businessId, partyId, iid]
            );
            saved += 1;
            continue;
          }

          const p = typeof r.price === 'number' ? r.price : Number(r.price);
          if (!Number.isFinite(p) || p < 0) {
            await client.query('ROLLBACK');
            return NextResponse.json({ error: 'Invalid price for item ' + iid }, { status: 400 });
          }

          await client.query(
            `INSERT INTO party_item_prices (business_id, party_id, item_id, price)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (business_id, party_id, item_id)
             DO UPDATE SET price = EXCLUDED.price`,
            [businessId, partyId, iid, p]
          );
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

    const itemOk = await queryOne(
      'SELECT id FROM items WHERE id = $1 AND business_id = $2',
      [itemPk, businessId]
    );
    if (!itemOk) {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 });
    }

    if (body.price === null || body.price === '') {
      await query(
        `DELETE FROM party_item_prices
         WHERE business_id = $1 AND party_id = $2 AND item_id = $3`,
        [businessId, partyId, itemPk]
      );
      return NextResponse.json({ ok: true, saved: 1 });
    }

    const p = typeof body.price === 'number' ? body.price : Number(body.price);
    if (!Number.isFinite(p) || p < 0) {
      return NextResponse.json({ error: 'Invalid price' }, { status: 400 });
    }

    await query(
      `INSERT INTO party_item_prices (business_id, party_id, item_id, price)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (business_id, party_id, item_id)
       DO UPDATE SET price = EXCLUDED.price`,
      [businessId, partyId, itemPk, p]
    );

    return NextResponse.json({ ok: true, saved: 1 });
  } catch (error: unknown) {
    console.error('[POST /api/pricing/party-item]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
