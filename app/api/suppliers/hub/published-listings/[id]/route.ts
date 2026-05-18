import { NextRequest, NextResponse } from 'next/server';
import * as db from '@/lib/db';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { getBusinessIdFromRequest } from '@/lib/auth-helpers';
import { assertFeatureAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { FeatureKeys } from '@/lib/featureKeys';
import type { SupplierPublishedListing } from '@/types/database';
import { SUPPLIERS_HUB_MAX_PUBLIC_PREVIEW_LISTINGS } from '@/lib/suppliers-hub';

/**
 * PATCH / DELETE — own listing only
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await request.json();
    const businessId = getBusinessIdFromRequest(request, body);
    const {
      audience,
      display_name: displayName,
      moq,
      lead_time_text: leadTimeText,
      price_display: priceDisplay,
      from_amount: fromAmount,
      sort_order: sortOrder,
      is_active: isActive,
      updated_by_user_id: updatedByUserId,
    } = body;
    const id = params.id;

    if (!businessId || !id) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    }
    if (!updatedByUserId) {
      return NextResponse.json(
        { error: 'updated_by_user_id is required for authorization' },
        { status: 400 }
      );
    }

    const existing = await db.queryOne<SupplierPublishedListing>(
      `SELECT * FROM supplier_published_listings WHERE id = $1 AND supplier_business_id = $2`,
      [id, businessId]
    );
    if (!existing) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    try {
      await authorize(updatedByUserId, 'purchases', 'update', { businessId });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    try {
      await assertFeatureAccess(businessId, FeatureKeys.SUPPLIER_MANAGEMENT);
    } catch (error) {
      if (error instanceof FeatureAccessDeniedError) {
        return error.toNextResponse();
      }
      throw error;
    }

    const nextAud =
      audience === 'linked_only'
        ? 'linked_only'
        : audience === 'public_preview'
          ? 'public_preview'
          : existing.audience;

    if (nextAud === 'public_preview' && existing.audience !== 'public_preview') {
      const cnt = await db.queryOne<{ n: string }>(
        `
        SELECT COUNT(*)::text AS n FROM supplier_published_listings
        WHERE supplier_business_id = $1 AND audience = 'public_preview' AND is_active = true
          AND id <> $2
        `,
        [businessId, id]
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

    const pd =
      priceDisplay && ['hidden', 'from_amount', 'on_request'].includes(priceDisplay)
        ? priceDisplay
        : existing.price_display;
    let fa =
      fromAmount !== undefined
        ? fromAmount == null
          ? null
          : parseFloat(String(fromAmount))
        : existing.from_amount != null
          ? Number(existing.from_amount)
          : null;
    if (pd !== 'from_amount') fa = null;

    const nextDisplayName =
      displayName !== undefined ? displayName : existing.display_name;
    const nextMoq =
      moq !== undefined ? (moq == null ? null : String(moq)) : existing.moq != null ? String(existing.moq) : null;
    const nextLead =
      leadTimeText !== undefined ? leadTimeText : existing.lead_time_text;
    const nextSort =
      sortOrder !== undefined ? parseInt(String(sortOrder), 10) : existing.sort_order;
    const nextActive =
      isActive !== undefined ? Boolean(isActive) : existing.is_active;

    const updated = await db.queryOne<SupplierPublishedListing>(
      `
      UPDATE supplier_published_listings SET
        audience = $3,
        display_name = $4,
        moq = $5::numeric,
        lead_time_text = $6,
        price_display = $7,
        from_amount = $8,
        sort_order = $9,
        is_active = $10,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND supplier_business_id = $2
      RETURNING *
      `,
      [
        id,
        businessId,
        nextAud,
        nextDisplayName,
        nextMoq,
        nextLead,
        pd,
        fa,
        nextSort,
        nextActive,
      ]
    );

    return NextResponse.json({ listing: updated });
  } catch (e: any) {
    console.error('hub published-listings PATCH', e);
    return NextResponse.json({ error: e.message || 'Failed' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = getBusinessIdFromRequest(request);
    const updatedByUserId = searchParams.get('updated_by_user_id');
    const id = params.id;

    if (!businessId || !id || !updatedByUserId) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    }

    const existing = await db.queryOne(
      `SELECT id FROM supplier_published_listings WHERE id = $1 AND supplier_business_id = $2`,
      [id, businessId]
    );
    if (!existing) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    try {
      await authorize(updatedByUserId, 'purchases', 'update', { businessId });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    try {
      await assertFeatureAccess(businessId, FeatureKeys.SUPPLIER_MANAGEMENT);
    } catch (error) {
      if (error instanceof FeatureAccessDeniedError) {
        return error.toNextResponse();
      }
      throw error;
    }

    await db.query(
      `DELETE FROM supplier_published_listings WHERE id = $1 AND supplier_business_id = $2`,
      [id, businessId]
    );
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error('hub published-listings DELETE', e);
    return NextResponse.json({ error: e.message || 'Failed' }, { status: 500 });
  }
}
