import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, getBusinessIdFromRequest, resolveCreatedByUserId } from '@/lib/auth-helpers';
import { queryRows, queryOne, query } from '@/lib/db';
import { authorize } from '@/lib/authorization';
import { AuthorizationError } from '@/lib/authorization';
import { requireTenantBusinessId } from '@/lib/auth-helpers';

export const dynamic = 'force-dynamic';

/**
 * GET /api/categories?business_id=xxx
 * Fetch all item categories for a business
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request); // REQUIRED for authorization

    if (!businessId) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    if (!userId) {
      return NextResponse.json(
        { error: 'user_id is required for authorization' },
        { status: 400 }
      );
    }

    // AUTHORIZATION: Check read permission (categories are part of items module)
    try {
      await authorize(userId, 'items', 'read', { businessId });
    } catch (error: any) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    const categories = await queryRows(`
      SELECT 
        c.id, 
        c.business_id, 
        c.name, 
        c.description,
        c.created_at,
        c.size_chart,
        COUNT(i.id) as item_count
      FROM categories c
      LEFT JOIN items i ON c.id = i.category_id AND i.is_active = true
      WHERE c.business_id = $1
      GROUP BY c.id, c.business_id, c.name, c.description, c.created_at, c.size_chart
      ORDER BY c.name ASC
    `, [businessId]);

    return NextResponse.json({ categories });
  } catch (error: any) {
    console.error('Error fetching categories:', error);
    return NextResponse.json(
      { error: 'Failed to fetch categories', details: error.message },
      { status: 500 }
    );
  }
}

/**
 * POST /api/categories
 * Create a new category
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { business_id: claimedBusinessId, name, description } = body;
    const tenant = requireTenantBusinessId(request, claimedBusinessId);
    if (!tenant.ok) return tenant.response;
    const business_id = tenant.businessId;
    const createdByUserId = resolveCreatedByUserId(request, body);

    if (!business_id || !name) {
      return NextResponse.json(
        { error: 'business_id and name are required' },
        { status: 400 }
      );
    }

    if (!createdByUserId) {
      return NextResponse.json(
        { error: 'created_by_user_id is required for authorization' },
        { status: 400 }
      );
    }

    // AUTHORIZATION: Check create permission (categories are part of items module)
    try {
      await authorize(createdByUserId, 'items', 'create', { businessId: business_id });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    let sizeChart: unknown = null;
    if (Object.prototype.hasOwnProperty.call(body, 'size_chart')) {
      const { validateProductExtras } = await import('@/lib/store/product-extras');
      const extras = validateProductExtras({ size_chart: body.size_chart });
      if (!extras.ok) return NextResponse.json({ error: extras.error }, { status: 400 });
      sizeChart = extras.value.size_chart ?? null;
    }

    const category = await queryOne(`
      INSERT INTO categories (business_id, name, description, size_chart)
      VALUES ($1, $2, $3, $4::jsonb)
      RETURNING *
    `, [business_id, name, description || null, sizeChart === null ? null : JSON.stringify(sizeChart)]);

    return NextResponse.json({ category }, { status: 201 });
  } catch (error: any) {
    console.error('Error creating category:', error);
    return NextResponse.json(
      { error: 'Failed to create category', details: error.message },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/categories  { id, size_chart }
 * Sets (or clears, with null) the size chart that items in the category inherit in the store.
 */
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { business_id: claimedBusinessId, id } = body;
    const tenant = requireTenantBusinessId(request, claimedBusinessId);
    if (!tenant.ok) return tenant.response;
    const business_id = tenant.businessId;
    const userId = resolveCreatedByUserId(request, body);

    if (!id || typeof id !== 'string' || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }
    if (!userId) {
      return NextResponse.json(
        { error: 'user_id is required for authorization' },
        { status: 400 }
      );
    }

    try {
      await authorize(userId, 'items', 'update', { businessId: business_id, resourceId: id });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    // A missing key would silently wipe the chart; only an explicit null clears it.
    if (!Object.prototype.hasOwnProperty.call(body, 'size_chart')) {
      return NextResponse.json({ error: 'size_chart is required' }, { status: 400 });
    }
    const { validateProductExtras } = await import('@/lib/store/product-extras');
    const extras = validateProductExtras({ size_chart: body.size_chart });
    if (!extras.ok) return NextResponse.json({ error: extras.error }, { status: 400 });
    const chart = extras.value.size_chart ?? null;

    const category = await queryOne(
      `UPDATE categories SET size_chart = $3::jsonb
        WHERE id = $1 AND business_id = $2
        RETURNING *`,
      [id, business_id, chart === null ? null : JSON.stringify(chart)],
    );
    if (!category) {
      return NextResponse.json({ error: 'Category not found' }, { status: 404 });
    }

    return NextResponse.json({ category });
  } catch (error: any) {
    console.error('Error updating category:', error);
    return NextResponse.json(
      { error: 'Failed to update category', details: error.message },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/categories?id=xxx
 * Delete a category
 */
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const categoryId = searchParams.get('id');
    const userId = getUserIdFromRequest(request); // REQUIRED for authorization
    const businessId = getBusinessIdFromRequest(request);

    if (!categoryId) {
      return NextResponse.json(
        { error: 'id is required' },
        { status: 400 }
      );
    }

    if (!userId || !businessId) {
      return NextResponse.json(
        { error: 'user_id and business_id are required for authorization' },
        { status: 400 }
      );
    }

    // AUTHORIZATION: Check delete permission (categories are part of items module)
    try {
      await authorize(userId, 'items', 'delete', { businessId, resourceId: categoryId });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    // Check if category has items
    const itemsCount = await queryOne(
      `SELECT COUNT(*) as count FROM items WHERE category_id = $1 AND business_id = $2`,
      [categoryId, businessId]
    );

    if (parseInt(itemsCount?.count || '0') > 0) {
      return NextResponse.json(
        { error: 'Cannot delete category with existing items. Please reassign items first.' },
        { status: 400 }
      );
    }

    await query(`DELETE FROM categories WHERE id = $1 AND business_id = $2`, [categoryId, businessId]);

    return NextResponse.json({
      success: true,
      message: 'Category deleted successfully'
    });
  } catch (error: any) {
    console.error('Error deleting category:', error);
    return NextResponse.json(
      { error: 'Failed to delete category', details: error.message },
      { status: 500 }
    );
  }
}

