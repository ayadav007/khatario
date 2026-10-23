import { NextRequest, NextResponse } from 'next/server';
import * as db from '@/lib/db';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { requireAuthenticatedTenant } from '@/lib/stock-request-security';
import { assertFeatureAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import type { SupplierPublishedListing } from '@/types/database';
import { SUPPLIERS_HUB_MAX_PUBLIC_PREVIEW_LISTINGS } from '@/lib/suppliers-hub';
import { assertOwnCollection, CatalogInputError, parseListingExtras } from '@/lib/supplier-catalog';

export const dynamic = 'force-dynamic';

/**
 * GET /api/suppliers/hub/published-listings — own business (supplier) listings + item names
 * POST — add listing
 * Business and user come from the session only; client-sent ids are ignored.
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

    const rows = await db.queryRows<
      SupplierPublishedListing & { item_name: string; item_unit: string; item_code: string | null }
    >(
      `
      SELECT l.*, i.name AS item_name, i.unit AS item_unit, i.code AS item_code
      FROM supplier_published_listings l
      -- Soft delete: exclude records where deleted_at is set
      INNER JOIN items i ON i.id = l.item_id AND i.business_id = l.supplier_business_id AND i.deleted_at IS NULL
      WHERE l.supplier_business_id = $1
      ORDER BY l.sort_order ASC, l.created_at ASC
      `,
      [businessId]
    );
    return NextResponse.json({ listings: rows });
  } catch (e: any) {
    console.error('hub published-listings GET', e);
    return NextResponse.json({ error: e.message || 'Failed' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = requireAuthenticatedTenant(request);
    if (auth instanceof NextResponse) return auth;
    const { businessId, userId: createdByUserId } = auth;
    const body = await request.json();
    const {
      item_id: itemId,
      audience,
      display_name: displayName,
      moq,
      lead_time_text: leadTimeText,
      price_display: priceDisplay,
      from_amount: fromAmount,
      sort_order: sortOrder,
    } = body;

    if (!itemId) {
      return NextResponse.json({ error: 'item_id is required' }, { status: 400 });
    }

    try {
      await authorize(createdByUserId, 'purchases', 'update', { businessId });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    try {
      await assertFeatureAccess(businessId, 'purchase_supplier_hub');
    } catch (error) {
      if (error instanceof FeatureAccessDeniedError) {
        return error.toNextResponse();
      }
      throw error;
    }

    const aud = audience === 'linked_only' ? 'linked_only' : 'public_preview';
    if (aud === 'public_preview') {
      const cnt = await db.queryOne<{ n: string }>(
        `
        SELECT COUNT(*)::text AS n FROM supplier_published_listings
        WHERE supplier_business_id = $1 AND audience = 'public_preview' AND is_active = true
        `,
        [businessId]
      );
      if (parseInt(cnt?.n || '0', 10) >= SUPPLIERS_HUB_MAX_PUBLIC_PREVIEW_LISTINGS) {
        return NextResponse.json(
          {
            error: `You can publish at most ${SUPPLIERS_HUB_MAX_PUBLIC_PREVIEW_LISTINGS} public preview listings.`,
          },
          { status: 400 }
        );
      }
    }

    const itemOk = await db.queryOne(
      // Soft delete: exclude records where deleted_at is set
      `SELECT 1 FROM items WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL AND is_active = true`,
      [itemId, businessId]
    );
    if (!itemOk) {
      return NextResponse.json(
        { error: 'Item not found or not part of your business' },
        { status: 400 }
      );
    }

    let extras: ReturnType<typeof parseListingExtras>;
    try {
      extras = parseListingExtras(body, businessId);
      if (extras.collection_id) await assertOwnCollection(businessId, extras.collection_id);
    } catch (e) {
      if (e instanceof CatalogInputError) return NextResponse.json({ error: e.message }, { status: e.status });
      throw e;
    }

    const pd = ['hidden', 'from_amount', 'on_request'].includes(priceDisplay)
      ? priceDisplay
      : 'on_request';
    const fa =
      pd === 'from_amount' && fromAmount != null ? parseFloat(String(fromAmount)) : null;

    try {
      const row = await db.queryOne<SupplierPublishedListing>(
        `
        INSERT INTO supplier_published_listings (
          supplier_business_id, item_id, audience, display_name, moq, lead_time_text,
          price_display, from_amount, sort_order, is_active,
          image_url, price, pack_label, order_multiple, collection_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true, $10, $11, $12, $13, $14)
        RETURNING *
        `,
        [
          businessId,
          itemId,
          aud,
          displayName ?? null,
          moq != null ? String(moq) : null,
          leadTimeText ?? null,
          pd,
          fa,
          sortOrder != null ? parseInt(String(sortOrder), 10) : 0,
          extras.image_url ?? null,
          extras.price ?? null,
          extras.pack_label ?? null,
          extras.order_multiple ?? null,
          extras.collection_id ?? null,
        ]
      );
      return NextResponse.json({ listing: row }, { status: 201 });
    } catch (ins: any) {
      if (ins.code === '23505') {
        return NextResponse.json(
          { error: 'This item is already in your published listings. Edit it from the list below.' },
          { status: 409 }
        );
      }
      throw ins;
    }
  } catch (e: any) {
    console.error('hub published-listings POST', e);
    return NextResponse.json({ error: e.message || 'Failed' }, { status: 500 });
  }
}
