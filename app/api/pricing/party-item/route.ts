import { NextRequest, NextResponse } from 'next/server';
import type { PoolClient } from 'pg';
import { queryOne, queryRows } from '@/lib/db';
import { getPool } from '@/lib/db';
import { getSessionScopedBusinessId, getUserIdFromRequest } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { assertFeatureAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { FeatureKeys } from '@/lib/featureKeys';
import {
  RateInputError,
  inTransaction,
  isRemoval,
  logPriceChange,
  optionalUuid,
  parseRateFields,
  type RateFields,
} from '@/lib/pricing/rate-input';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** '' or missing means the whole item; a UUID means that variant; anything else is 'invalid'. */
function parseVariantId(raw: unknown): string | null | 'invalid' {
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw !== 'string' || !UUID_RE.test(raw.trim())) return 'invalid';
  return raw.trim();
}

/**
 * Save one customer price (or remove it when it has neither price nor discount) and log the change.
 * Variant rows and whole-item rows have separate unique indexes.
 */
async function writeOverride(
  client: PoolClient,
  businessId: string,
  partyId: string,
  itemId: string,
  variantId: string | null,
  fields: RateFields,
  userId: string
) {
  const old = (
    await client.query(
      `SELECT price::float AS price, discount_percent::float AS discount_percent
         FROM party_item_prices
        WHERE business_id = $1 AND party_id = $2 AND item_id = $3 AND variant_id IS NOT DISTINCT FROM $4::uuid
        FOR UPDATE`,
      [businessId, partyId, itemId, variantId]
    )
  ).rows[0] ?? null;

  if (isRemoval(fields)) {
    await client.query(
      `DELETE FROM party_item_prices
       WHERE business_id = $1 AND party_id = $2 AND item_id = $3 AND variant_id IS NOT DISTINCT FROM $4::uuid`,
      [businessId, partyId, itemId, variantId]
    );
  } else {
    const conflict = variantId
      ? 'ON CONFLICT (business_id, party_id, item_id, variant_id) WHERE variant_id IS NOT NULL'
      : 'ON CONFLICT (business_id, party_id, item_id) WHERE variant_id IS NULL';
    await client.query(
      `INSERT INTO party_item_prices (business_id, party_id, item_id, variant_id, price, discount_percent, valid_from, valid_to)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ${conflict}
       DO UPDATE SET price = EXCLUDED.price, discount_percent = EXCLUDED.discount_percent,
                     valid_from = EXCLUDED.valid_from, valid_to = EXCLUDED.valid_to, updated_at = CURRENT_TIMESTAMP`,
      [businessId, partyId, itemId, variantId, fields.price, fields.discount_percent, fields.valid_from, fields.valid_to]
    );
  }
  await logPriceChange(client, {
    businessId,
    scope: 'party_item',
    partyId,
    itemId,
    variantId,
    old,
    next: isRemoval(fields) ? null : fields,
    changedBy: userId,
  });
}

/**
 * GET /api/pricing/party-item
 * - ?party_id=&item_id=[&variant_id=]  → { price: number | null } (single lookup; a variant
 *   without its own price falls back to the whole-item price)
 * - ?party_id=          → { overrides: { item_id, variant_id, price, discount_percent, valid_from, valid_to }[],
 *                           variants, price_level_id } (all overrides for party)
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
      const cust = await queryOne<{ id: string; price_level_id: string | null }>(
        'SELECT id, price_level_id FROM customers WHERE id = $1 AND business_id = $2',
        [pid, businessId]
      );
      if (!cust) {
        return NextResponse.json({ error: 'Customer not found' }, { status: 404 });
      }

      const rows = await queryRows<{
        item_id: string;
        variant_id: string | null;
        price: string | number | null;
        discount_percent: string | number | null;
        valid_from: string | null;
        valid_to: string | null;
      }>(
        `SELECT item_id, variant_id, price, discount_percent, valid_from::text AS valid_from, valid_to::text AS valid_to
         FROM party_item_prices
         WHERE business_id = $1 AND party_id = $2
         ORDER BY item_id, variant_id NULLS FIRST`,
        [businessId, pid]
      );

      const overrides = rows.map((r) => ({
        item_id: r.item_id,
        variant_id: r.variant_id,
        price: r.price == null ? null : Number(r.price),
        discount_percent: r.discount_percent == null ? null : Number(r.discount_percent),
        valid_from: r.valid_from,
        valid_to: r.valid_to,
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

      return NextResponse.json({ overrides, variants, price_level_id: cust.price_level_id });
    }

    const row = await queryOne<{ price: string | number | null }>(
      `SELECT price
       FROM party_item_prices
       WHERE business_id = $1
         AND party_id = $2
         AND item_id = $3
         AND (variant_id IS NULL OR variant_id = $4::uuid)
         AND price IS NOT NULL
         AND (valid_from IS NULL OR valid_from <= CURRENT_DATE)
         AND (valid_to IS NULL OR valid_to >= CURRENT_DATE)
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

type RowInput = {
  item_id: string;
  variant_id?: string | null;
  price?: number | null;
  discount_percent?: number | null;
  valid_from?: string | null;
  valid_to?: string | null;
};

/**
 * POST /api/pricing/party-item
 * Body (single): { party_id, item_id, variant_id?, price?, discount_percent?, valid_from?, valid_to? }
 * Body (bulk):   { party_id, rows: RowInput[] }  (max 300 rows)
 * A row with neither price nor discount_percent removes the customer price for that item (or variant).
 * Every change is logged in price_change_log.
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

    if (!UUID_RE.test(partyId)) {
      return NextResponse.json({ error: 'Invalid party_id' }, { status: 400 });
    }
    const cust = await queryOne<{ id: string }>(
      'SELECT id FROM customers WHERE id = $1 AND business_id = $2',
      [partyId, businessId]
    );
    if (!cust) {
      return NextResponse.json({ error: 'Customer not found' }, { status: 404 });
    }

    const rows: RowInput[] = Array.isArray(body.rows) ? body.rows : [body];
    if (rows.length > 300) {
      return NextResponse.json({ error: 'Too many rows (max 300)' }, { status: 400 });
    }

    // Validate everything before writing anything.
    const parsed: Array<{ itemId: string; variantId: string | null; fields: RateFields }> = [];
    for (const r of rows) {
      const itemId = typeof r?.item_id === 'string' ? r.item_id.trim() : '';
      if (!itemId) {
        if (Array.isArray(body.rows)) continue;
        return NextResponse.json({ error: 'item_id is required for single save' }, { status: 400 });
      }
      try {
        optionalUuid(itemId, 'item_id');
        const variantId = optionalUuid(r.variant_id, 'variant_id');
        parsed.push({ itemId, variantId, fields: parseRateFields(r as Record<string, unknown>) });
      } catch (e) {
        if (e instanceof RateInputError) return NextResponse.json({ error: `${e.message} for item ${itemId}` }, { status: 400 });
        throw e;
      }
    }

    const itemIds = [...new Set(parsed.map((p) => p.itemId))];
    const found = new Set(
      (await queryRows<{ id: string }>('SELECT id FROM items WHERE business_id = $1 AND id = ANY($2::uuid[])', [businessId, itemIds])).map(
        (r) => r.id
      )
    );
    const missingItem = itemIds.find((id) => !found.has(id));
    if (missingItem) {
      return NextResponse.json({ error: `Item not found: ${missingItem}` }, { status: 404 });
    }
    const variantPairs = parsed.filter((p) => p.variantId);
    if (variantPairs.length) {
      const ok = new Set(
        (
          await queryRows<{ id: string; item_id: string }>('SELECT id, item_id FROM item_variants WHERE id = ANY($1::uuid[])', [
            variantPairs.map((p) => p.variantId),
          ])
        ).map((r) => `${r.item_id}:${r.id}`)
      );
      const bad = variantPairs.find((p) => !ok.has(`${p.itemId}:${p.variantId}`));
      if (bad) return NextResponse.json({ error: `Variant not found: ${bad.variantId}` }, { status: 404 });
    }

    await inTransaction(getPool(), async (client) => {
      for (const p of parsed) {
        await writeOverride(client, businessId, partyId, p.itemId, p.variantId, p.fields, userId);
      }
    });

    return NextResponse.json({ ok: true, saved: parsed.length });
  } catch (error: unknown) {
    console.error('[POST /api/pricing/party-item]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
