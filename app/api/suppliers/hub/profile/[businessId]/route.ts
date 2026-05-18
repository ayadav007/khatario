import { NextRequest, NextResponse } from 'next/server';
import * as db from '@/lib/db';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import type { BusinessDiscoveryVisibility } from '@/types/database';

/**
 * GET /api/suppliers/hub/profile/[businessId]
 * Authenticated hub profile + listings visible to viewer.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { businessId: string } }
) {
  try {
    const viewerBusinessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);
    const targetId = params.businessId;
    if (!viewerBusinessId || !userId || !targetId) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    }
    try {
      await authorize(userId, 'purchases', 'read', { businessId: viewerBusinessId });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    const discovery = await db.queryOne<{
      visibility: BusinessDiscoveryVisibility;
      profile_summary: string | null;
      featured_categories: string[] | null;
      directory_approved: boolean;
      public_slug: string | null;
    }>(
      `SELECT visibility, profile_summary, featured_categories, directory_approved, public_slug
       FROM business_discovery WHERE business_id = $1`,
      [targetId]
    );

    if (!discovery || discovery.visibility === 'hidden') {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    if (discovery.visibility === 'directory' && !discovery.directory_approved) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const business = await db.queryOne<{
      id: string;
      name: string;
      city: string | null;
      state: string | null;
      gstin: string | null;
      phone: string | null;
      email: string | null;
    }>(
      `SELECT id, name, city, state, gstin, phone, email FROM businesses WHERE id = $1`,
      [targetId]
    );
    if (!business) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const isLinked = !!(await db.queryOne(
      `SELECT 1 FROM suppliers
       WHERE business_id = $1 AND linked_business_id = $2
         AND approval_status = 'approved' AND is_active = true`,
      [viewerBusinessId, targetId]
    ));

    const pendingOut = await db.queryOne<{ id: string }>(
      `SELECT id FROM supplier_connection_requests
       WHERE buyer_business_id = $1 AND supplier_business_id = $2 AND status = 'pending'`,
      [viewerBusinessId, targetId]
    );

    const buyerSupplier = await db.queryOne<{ id: string }>(
      `SELECT id FROM suppliers
       -- Soft delete: exclude records where deleted_at is set
       WHERE business_id = $1 AND linked_business_id = $2 AND deleted_at IS NULL AND is_active = true
       LIMIT 1`,
      [viewerBusinessId, targetId]
    );

    const listings = await db.queryRows<{
      id: string;
      item_id: string;
      audience: string;
      display_name: string | null;
      moq: string | null;
      lead_time_text: string | null;
      price_display: string;
      from_amount: string | null;
      sort_order: number;
      item_name: string;
      item_unit: string;
      item_code: string | null;
    }>(
      `
      SELECT l.id, l.item_id, l.audience, l.display_name, l.moq::text, l.lead_time_text,
             l.price_display, l.from_amount::text, l.sort_order,
             i.name AS item_name, i.unit AS item_unit, i.code AS item_code
      FROM supplier_published_listings l
      -- Soft delete: exclude records where deleted_at is set
      INNER JOIN items i ON i.id = l.item_id AND i.business_id = l.supplier_business_id AND i.deleted_at IS NULL
      WHERE l.supplier_business_id = $1
        AND l.is_active = true
        AND (
          ($2::boolean AND l.audience IN ('public_preview', 'linked_only'))
          OR (NOT $2::boolean AND l.audience = 'public_preview')
        )
      ORDER BY l.sort_order ASC, l.created_at ASC
      `,
      [targetId, isLinked]
    );

    return NextResponse.json({
      business,
      discovery: {
        visibility: discovery.visibility,
        profile_summary: discovery.profile_summary,
        featured_categories: discovery.featured_categories || [],
        public_slug: discovery.public_slug,
      },
      viewer: {
        is_linked: isLinked,
        pending_request_id: pendingOut?.id || null,
        supplier_record_id: buyerSupplier?.id || null,
      },
      listings,
    });
  } catch (e: any) {
    console.error('hub profile GET', e);
    return NextResponse.json({ error: e.message || 'Failed' }, { status: 500 });
  }
}
