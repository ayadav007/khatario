export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { queryRows } from '@/lib/db';
import { createRepack, REPACK_SELECT, RepackError, type WastageReason } from '@/lib/repack-service';
import { repackContext, repackErrorResponse, UUID_RE } from '@/lib/repack-route';

/**
 * GET /api/inventory-adjustments/repacks?item_id=&limit=
 * Recent repacks, optionally only those that took from or packed into one item.
 */
export async function GET(request: NextRequest) {
  const ctx = await repackContext(request, 'read');
  if (ctx instanceof NextResponse) return ctx;
  try {
    const { searchParams } = new URL(request.url);
    const itemId = searchParams.get('item_id');
    const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '50', 10) || 50, 1), 200);
    const repacks = await queryRows(
      `${REPACK_SELECT}
        WHERE r.business_id = $1
          AND ($2::uuid IS NULL OR r.source_item_id = $2::uuid OR r.packed_item_id = $2::uuid)
        ORDER BY r.repack_date DESC, r.created_at DESC
        LIMIT $3`,
      [ctx.businessId, itemId && UUID_RE.test(itemId) ? itemId : null, limit]
    );
    return NextResponse.json({ repacks });
  } catch (error) {
    return repackErrorResponse(error, 'Failed to load repacks');
  }
}

/**
 * POST /api/inventory-adjustments/repacks
 * { source_item_id, packed_item_id, source_qty, packed_qty, content_per_unit?, wastage_reason?,
 *   wastage_notes?, notes?, repack_date?, branch_id?, location_id? }
 * Business and user come from the session; branch / warehouse access is checked here.
 */
export async function POST(request: NextRequest) {
  const ctx = await repackContext(request, 'create');
  if (ctx instanceof NextResponse) return ctx;
  try {
    const body = await request.json().catch(() => ({}));
    const sourceItemId = String(body.source_item_id || '');
    const packedItemId = String(body.packed_item_id || '');
    if (!UUID_RE.test(sourceItemId) || !UUID_RE.test(packedItemId)) {
      throw new RepackError('Pick both items', 'ITEM_REQUIRED');
    }
    const branchId: string | null = UUID_RE.test(String(body.branch_id || '')) ? body.branch_id : null;
    const locationId: string | null = UUID_RE.test(String(body.location_id || '')) ? body.location_id : null;

    if (locationId) {
      const { checkUserWarehouseAccess } = await import('@/lib/warehouse-access');
      const access = await checkUserWarehouseAccess(ctx.userId, locationId);
      if (!access?.can_create_transactions) {
        throw new RepackError('You cannot move stock in this warehouse', 'WAREHOUSE_ACCESS_DENIED', 403);
      }
    } else if (branchId) {
      const { getUserAccessibleBranchIds } = await import('@/lib/branch-access');
      const allowed = await getUserAccessibleBranchIds(ctx.userId).catch(() => [] as string[]);
      if (allowed.length > 0 && !allowed.includes(branchId)) {
        throw new RepackError('You cannot move stock in this branch', 'BRANCH_ACCESS_DENIED', 403);
      }
    }

    const content = body.content_per_unit;
    const result = await createRepack({
      businessId: ctx.businessId,
      userId: ctx.userId,
      sourceItemId,
      packedItemId,
      sourceQty: Number(body.source_qty),
      packedQty: Number(body.packed_qty),
      contentPerUnit: content != null && content !== '' ? Number(content) : null,
      wastageReason: (body.wastage_reason || null) as WastageReason | null,
      wastageNotes: body.wastage_notes || null,
      notes: body.notes || null,
      repackDate:
        typeof body.repack_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.repack_date)
          ? body.repack_date
          : new Date().toISOString().slice(0, 10),
      branchId,
      locationId,
    });
    return NextResponse.json({ success: true, repack: result }, { status: 201 });
  } catch (error) {
    return repackErrorResponse(error, 'Failed to save the repack');
  }
}
