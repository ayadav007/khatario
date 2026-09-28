import { NextRequest, NextResponse } from 'next/server';
import * as db from '@/lib/db';
import { assertFeatureAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { requireTenantBusinessId, getUserIdFromRequest } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { branchOfWarehouse, moveOneBranchStock } from '@/lib/inventory/warehouse-mode-switch';

export const dynamic = 'force-dynamic';

/**
 * POST /api/locations/migrate-stock
 * Moves the owning branch's stock into the given warehouse. Only that branch's quantities move,
 * and items that already hold stock in one of the branch's warehouses are skipped, so a re-run
 * never adds stock twice. `location_id` is accepted as a legacy alias for `warehouse_id`.
 */
export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const tenant = requireTenantBusinessId(request, body.business_id as string | undefined);
  if (!tenant.ok) return tenant.response;
  const businessId = tenant.businessId;
  const targetWarehouseId = (body.warehouse_id || body.location_id) as string | undefined;
  if (!targetWarehouseId) {
    return NextResponse.json({ error: 'warehouse_id (or location_id) is required' }, { status: 400 });
  }
  const userId = getUserIdFromRequest(request);
  if (!userId) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });

  try {
    await assertFeatureAccess(businessId, 'multi_warehouse');
    await authorize(userId, 'settings', 'update', { businessId });
  } catch (error) {
    if (error instanceof FeatureAccessDeniedError) return error.toNextResponse();
    if (error instanceof AuthorizationError) return error.toNextResponse();
    throw error;
  }

  const client = await db.getPool().connect();
  try {
    await client.query('BEGIN');
    const wh = await client.query('SELECT id FROM warehouses WHERE id = $1 AND business_id = $2', [
      targetWarehouseId,
      businessId,
    ]);
    if (wh.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Warehouse not found or does not belong to this business' }, { status: 404 });
    }
    const branchId = await branchOfWarehouse(client, targetWarehouseId);
    if (!branchId) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: 'Link this warehouse to a branch first; only that branch\'s stock can move into it.', code: 'WAREHOUSE_WITHOUT_BRANCH' },
        { status: 400 }
      );
    }
    const result = await moveOneBranchStock(client, businessId, branchId, targetWarehouseId);
    await client.query('COMMIT');
    const moved = result.moved[0];
    return NextResponse.json({
      success: true,
      message: `Moved ${moved?.items ?? 0} items into the warehouse (${result.skippedExisting} already had warehouse stock)`,
      migrated_count: moved?.items ?? 0,
      skipped_existing: result.skippedExisting,
    });
  } catch (error: any) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error migrating stock:', error);
    return NextResponse.json(
      { error: 'Failed to migrate stock', details: error?.message || 'Unknown error occurred', success: false },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}
