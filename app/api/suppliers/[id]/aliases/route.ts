import { NextRequest, NextResponse } from 'next/server';
import { query as dbQuery, queryOne } from '@/lib/db';
import { getAuthenticatedUserId, requireTenantBusinessId } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';

export const dynamic = 'force-dynamic';

/**
 * Session user, session business, suppliers permission, and the supplier in the path confined
 * to that business. Nothing is read or written for a supplier of another business.
 */
async function requireSupplierAccess(
  request: NextRequest,
  supplierId: string,
  action: 'read' | 'update',
): Promise<{ ok: true; userId: string; businessId: string } | { ok: false; response: NextResponse }> {
  const tenant = requireTenantBusinessId(request);
  if (!tenant.ok) return tenant;
  const userId = getAuthenticatedUserId(request);
  if (!userId) {
    return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  try {
    await authorize(userId, 'suppliers', action, { businessId: tenant.businessId });
  } catch (error) {
    if (error instanceof AuthorizationError) return { ok: false, response: error.toNextResponse() };
    throw error;
  }
  const supplier = await queryOne<{ id: string }>(
    `SELECT id FROM suppliers WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL`,
    [supplierId, tenant.businessId],
  );
  if (!supplier) {
    return { ok: false, response: NextResponse.json({ error: 'Supplier not found' }, { status: 404 }) };
  }
  return { ok: true, userId, businessId: tenant.businessId };
}

/**
 * GET /api/suppliers/[id]/aliases
 * Get all aliases for one of this business's suppliers
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const access = await requireSupplierAccess(request, params.id, 'read');
    if (!access.ok) return access.response;

    const aliases = await dbQuery(
      `SELECT a.*
         FROM supplier_name_aliases a
         INNER JOIN suppliers s ON s.id = a.supplier_id
        WHERE a.supplier_id = $1 AND s.business_id = $2
        ORDER BY a.usage_count DESC, a.created_at DESC`,
      [params.id, access.businessId]
    );

    return NextResponse.json({ aliases });

  } catch (error: any) {
    console.error('Error getting supplier aliases:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST /api/suppliers/[id]/aliases
 * Create a new alias for one of this business's suppliers
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const access = await requireSupplierAccess(request, params.id, 'update');
    if (!access.ok) return access.response;

    const supplierId = params.id;
    const body = await request.json();
    const { alias_name, alias_type = 'manual' } = body;

    if (!alias_name) {
      return NextResponse.json(
        { error: 'alias_name is required' },
        { status: 400 }
      );
    }

    // Check if alias already exists for this supplier
    const existing = await queryOne(
      `SELECT id FROM supplier_name_aliases
       WHERE supplier_id = $1 AND LOWER(alias_name) = LOWER($2)`,
      [supplierId, alias_name]
    );

    if (existing) {
      return NextResponse.json(
        { error: 'Alias already exists for this supplier' },
        { status: 409 }
      );
    }

    // Create alias; the join re-asserts the supplier is this business's
    const alias = await queryOne(
      `INSERT INTO supplier_name_aliases (
        supplier_id, alias_name, alias_type, created_by
      )
      SELECT s.id, $2, $3, $4
        FROM suppliers s
       WHERE s.id = $1 AND s.business_id = $5 AND s.deleted_at IS NULL
      RETURNING *`,
      [supplierId, alias_name, alias_type, access.userId, access.businessId]
    );
    if (!alias) {
      return NextResponse.json({ error: 'Supplier not found' }, { status: 404 });
    }

    return NextResponse.json({ alias }, { status: 201 });

  } catch (error: any) {
    console.error('Error creating supplier alias:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * DELETE /api/suppliers/[id]/aliases?alias_id=xxx
 * Delete an alias of one of this business's suppliers
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const access = await requireSupplierAccess(request, params.id, 'update');
    if (!access.ok) return access.response;

    const supplierId = params.id;
    const { searchParams } = new URL(request.url);
    const aliasId = searchParams.get('alias_id');

    if (!aliasId) {
      return NextResponse.json(
        { error: 'alias_id is required' },
        { status: 400 }
      );
    }

    await dbQuery(
      `DELETE FROM supplier_name_aliases a
        USING suppliers s
       WHERE a.id = $1 AND a.supplier_id = $2
         AND s.id = a.supplier_id AND s.business_id = $3`,
      [aliasId, supplierId, access.businessId]
    );

    return NextResponse.json({ success: true });

  } catch (error: any) {
    console.error('Error deleting supplier alias:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
