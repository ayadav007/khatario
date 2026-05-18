import { NextRequest, NextResponse } from 'next/server';
import { queryRows, queryOne } from '@/lib/db';
import { Item } from '@/types/database';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { getUserIdFromRequest, getBusinessIdFromRequest, getSessionScopedBusinessId } from '@/lib/auth-helpers';

/**
 * GET /api/items/[id]/bundle
 * Bundle header item plus components with nested item snapshot (qty per bundle).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const bundleId = params.id;
    const businessId = getSessionScopedBusinessId(request) ?? getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);

    if (!businessId) {
      return NextResponse.json({ error: 'business_id is required' }, { status: 400 });
    }
    if (!userId) {
      return NextResponse.json(
        { error: 'user_id is required for authorization' },
        { status: 400 }
      );
    }

    const bundle = await queryOne<Item>(
      `SELECT * FROM items WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL`,
      [bundleId, businessId]
    );

    if (!bundle) {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 });
    }

    try {
      await authorize(userId, 'items', 'read', { businessId: bundle.business_id });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    if (!bundle.is_bundle) {
      return NextResponse.json(
        { error: 'This item is not a bundle', code: 'NOT_A_BUNDLE' },
        { status: 400 }
      );
    }

    const rows = await queryRows<{
      id: string;
      bundle_id: string;
      item_id: string;
      quantity: string | number;
      item_name: string;
      unit: string | null;
      code: string | null;
      selling_price: string | number | null;
      purchase_price: string | number | null;
    }>(
      `SELECT bi.id, bi.bundle_id, bi.item_id, bi.quantity,
              i.name AS item_name, i.unit, i.code, i.selling_price, i.purchase_price
       FROM bundle_items bi
       INNER JOIN items i ON i.id = bi.item_id AND i.business_id = $2
         AND i.deleted_at IS NULL
         AND (i.is_active IS NULL OR i.is_active = true)
       WHERE bi.bundle_id = $1
       ORDER BY bi.id`,
      [bundleId, businessId]
    );

    const components = rows.map((r) => ({
      id: r.id,
      item_id: r.item_id,
      quantity: Number(r.quantity),
      item: {
        name: r.item_name,
        unit: r.unit,
        code: r.code,
        selling_price: r.selling_price,
        purchase_price: r.purchase_price,
      },
    }));

    return NextResponse.json({
      bundle,
      components,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
