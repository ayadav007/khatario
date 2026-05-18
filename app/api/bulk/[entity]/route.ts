import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { assertFeatureAccess } from '@/lib/subscription/feature-access';

const ENTITY_CONFIG = {
  invoices: {
    table: 'invoices',
    idColumn: 'id',
    businessColumn: 'business_id',
  },
  customers: {
    table: 'customers',
    idColumn: 'id',
    businessColumn: 'business_id',
  },
  items: {
    table: 'items',
    idColumn: 'id',
    businessColumn: 'business_id',
  },
  purchases: {
    table: 'purchases',
    idColumn: 'id',
    businessColumn: 'business_id',
  },
};

// POST - Bulk operations
export async function POST(
  request: NextRequest,
  { params }: { params: { entity: string } }
) {
  try {
    const { entity } = params;
    const body = await request.json();
    const { business_id, action, ids, data } = body;

    if (!business_id || !action || !ids || !Array.isArray(ids)) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Check feature access
    await assertFeatureAccess(business_id, 'bulk_actions');

    // Get entity config
    const config = ENTITY_CONFIG[entity as keyof typeof ENTITY_CONFIG];
    if (!config) {
      return NextResponse.json(
        { error: 'Invalid entity type' },
        { status: 400 }
      );
    }

    const { table, idColumn, businessColumn } = config;

    // Verify all IDs belong to the business
    const verifyQuery = `
      SELECT COUNT(*) as count
      FROM ${table}
      WHERE ${idColumn} = ANY($1)
        AND ${businessColumn} = $2
    `;
    const verifyResult = await db.queryRows(verifyQuery, [ids, business_id]);
    
    if (verifyResult[0].count !== ids.length) {
      return NextResponse.json(
        { error: 'Some IDs do not belong to this business' },
        { status: 403 }
      );
    }

    let result;

    switch (action) {
      case 'delete':
        result = await bulkDelete(table, idColumn, ids, business_id);
        break;

      case 'update':
        result = await bulkUpdate(table, idColumn, ids, business_id, data);
        break;

      case 'mark_paid':
        result = await bulkUpdate(table, idColumn, ids, business_id, { status: 'paid' });
        break;

      case 'mark_unpaid':
        result = await bulkUpdate(table, idColumn, ids, business_id, { status: 'unpaid' });
        break;

      case 'archive':
        result = await bulkUpdate(table, idColumn, ids, business_id, { is_archived: true });
        break;

      case 'unarchive':
        result = await bulkUpdate(table, idColumn, ids, business_id, { is_archived: false });
        break;

      default:
        return NextResponse.json(
          { error: 'Invalid action' },
          { status: 400 }
        );
    }

    return NextResponse.json({
      success: true,
      affected: result.affected,
      message: `Successfully ${action}ed ${result.affected} ${entity}`,
    });
  } catch (error: any) {
    console.error('Bulk operation failed:', error);
    return NextResponse.json(
      { error: error.message || 'Bulk operation failed' },
      { status: 500 }
    );
  }
}

async function bulkDelete(
  table: string,
  idColumn: string,
  ids: string[],
  businessId: string
): Promise<{ affected: number }> {
  const query = `
    DELETE FROM ${table}
    WHERE ${idColumn} = ANY($1)
      AND business_id = $2
  `;
  
  const result = await db.query(query, [ids, businessId]);
  return { affected: result.rowCount || 0 };
}

async function bulkUpdate(
  table: string,
  idColumn: string,
  ids: string[],
  businessId: string,
  data: Record<string, any>
): Promise<{ affected: number }> {
  // Build SET clause
  const setClause = Object.keys(data)
    .map((key, index) => `${key} = $${index + 3}`)
    .join(', ');

  const values = Object.values(data);

  const query = `
    UPDATE ${table}
    SET ${setClause}, updated_at = CURRENT_TIMESTAMP
    WHERE ${idColumn} = ANY($1)
      AND business_id = $2
  `;

  const result = await db.query(query, [ids, businessId, ...values]);
  return { affected: result.rowCount || 0 };
}

// Add feature to platform registry
// (This would typically be in a migration, but including here for reference)
/*
INSERT INTO platform_features (feature_key, feature_name, description, category, is_enabled)
VALUES (
  'bulk_actions',
  'Bulk Actions',
  'Perform actions on multiple items at once',
  'ui_features',
  TRUE
)
ON CONFLICT (feature_key) DO NOTHING;

INSERT INTO subscription_plan_features (plan_id, feature_key, limit_value)
SELECT id, 'bulk_actions', NULL
FROM subscription_plans
ON CONFLICT (plan_id, feature_key) DO NOTHING;
*/
