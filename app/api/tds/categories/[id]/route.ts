import { NextRequest, NextResponse } from 'next/server';
import { queryOne, query } from '@/lib/db';
import { TDSCategory } from '@/types/database';

/**
 * GET /api/tds/categories/[id]
 * Get a single TDS category
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const categoryId = params.id;
    const { searchParams } = new URL(request.url);
    const businessId = searchParams.get('business_id');

    if (!businessId) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    const category = await queryOne<TDSCategory>(
      `SELECT * FROM tds_categories WHERE id = $1 AND business_id = $2`,
      [categoryId, businessId]
    );

    if (!category) {
      return NextResponse.json(
        { error: 'TDS category not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ category });
  } catch (error: any) {
    console.error('Error fetching TDS category:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/tds/categories/[id]
 * Update a TDS category
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const categoryId = params.id;
    const body = await request.json();
    const {
      business_id,
      section_code,
      section_name,
      description,
      rate,
      threshold_amount = 0,
    } = body;

    if (!business_id) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    // Check if category exists
    const existing = await queryOne(
      'SELECT id FROM tds_categories WHERE id = $1 AND business_id = $2',
      [categoryId, business_id]
    );

    if (!existing) {
      return NextResponse.json(
        { error: 'TDS category not found' },
        { status: 404 }
      );
    }

    // Check if section code already exists for another category
    if (section_code) {
      const duplicate = await queryOne(
        'SELECT id FROM tds_categories WHERE business_id = $1 AND section_code = $2 AND id != $3',
        [business_id, section_code, categoryId]
      );

      if (duplicate) {
        return NextResponse.json(
          { error: 'TDS category with this section code already exists' },
          { status: 409 }
        );
      }
    }

    const category = await queryOne<TDSCategory>(
      `UPDATE tds_categories
       SET section_code = COALESCE($1, section_code),
           section_name = COALESCE($2, section_name),
           description = COALESCE($3, description),
           rate = COALESCE($4, rate),
           threshold_amount = COALESCE($5, threshold_amount),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $6 AND business_id = $7
       RETURNING *`,
      [
        section_code,
        section_name,
        description || null,
        rate,
        threshold_amount,
        categoryId,
        business_id,
      ]
    );

    return NextResponse.json({ category });
  } catch (error: any) {
    console.error('Error updating TDS category:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/tds/categories/[id]
 * Delete a TDS category
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const categoryId = params.id;
    const { searchParams } = new URL(request.url);
    const businessId = searchParams.get('business_id');

    if (!businessId) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    // Check if category is used in transactions
    const usedInTransactions = await queryOne(
      'SELECT id FROM tds_transactions WHERE tds_category_id = $1 LIMIT 1',
      [categoryId]
    );

    if (usedInTransactions) {
      return NextResponse.json(
        { error: 'Cannot delete category that is used in TDS transactions' },
        { status: 400 }
      );
    }

    const result = await query(
      'DELETE FROM tds_categories WHERE id = $1 AND business_id = $2',
      [categoryId, businessId]
    );

    if (result.rowCount === 0) {
      return NextResponse.json(
        { error: 'TDS category not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ message: 'TDS category deleted successfully' });
  } catch (error: any) {
    console.error('Error deleting TDS category:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

