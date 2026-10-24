import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { assertFeatureAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { getUserIdFromRequest, requireTenantBusinessId } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';

export const dynamic = 'force-dynamic';

const ENTITY_CONFIG = {
  invoices: { table: 'invoices', module: 'invoices' },
  customers: { table: 'customers', module: 'customers' },
  items: { table: 'items', module: 'items' },
  purchases: { table: 'purchases', module: 'purchases' },
} as const;

/**
 * Only non-financial flags may be changed in bulk. Deleting, re-statusing or
 * editing financial documents must go through their own routes so ledger,
 * stock, period-lock and GST-filed checks run.
 */
const ACTIONS = {
  archive: true,
  unarchive: false,
} as const;

export async function POST(
  request: NextRequest,
  { params }: { params: { entity: string } }
) {
  try {
    const body = await request.json();
    const { action, ids } = body ?? {};

    const tenant = requireTenantBusinessId(request, body?.business_id);
    if (!tenant.ok) return tenant.response;
    const businessId = tenant.businessId;
    const userId = getUserIdFromRequest(request);
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    if (!action || !Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const config = ENTITY_CONFIG[params.entity as keyof typeof ENTITY_CONFIG];
    if (!config) {
      return NextResponse.json({ error: 'Invalid entity type' }, { status: 400 });
    }
    if (!Object.prototype.hasOwnProperty.call(ACTIONS, action)) {
      return NextResponse.json(
        {
          error: 'This bulk action is not supported. Delete, cancel or change financial documents individually.',
          code: 'BULK_ACTION_NOT_ALLOWED',
        },
        { status: 400 }
      );
    }

    try {
      await assertFeatureAccess(businessId, 'bulk_actions');
      await authorize(userId, config.module, 'update', { businessId });
    } catch (error) {
      if (error instanceof FeatureAccessDeniedError) return error.toNextResponse();
      if (error instanceof AuthorizationError) return error.toNextResponse();
      throw error;
    }

    const uniqueIds = Array.from(new Set(ids.map(String)));
    const owned = await db.queryRows<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM ${config.table} WHERE id = ANY($1::uuid[]) AND business_id = $2`,
      [uniqueIds, businessId]
    );
    if (Number(owned[0]?.count ?? 0) !== uniqueIds.length) {
      return NextResponse.json({ error: 'Some IDs do not belong to this business' }, { status: 403 });
    }

    const archived = ACTIONS[action as keyof typeof ACTIONS];
    const result = await db.query(
      `UPDATE ${config.table}
          SET is_archived = $3, updated_at = CURRENT_TIMESTAMP
        WHERE id = ANY($1::uuid[]) AND business_id = $2`,
      [uniqueIds, businessId, archived]
    );

    return NextResponse.json({
      success: true,
      affected: result.rowCount || 0,
      message: `Successfully ${action}d ${result.rowCount || 0} ${params.entity}`,
    });
  } catch (error: any) {
    console.error('Bulk operation failed:', error);
    return NextResponse.json({ error: 'Bulk operation failed' }, { status: 500 });
  }
}
