import { NextResponse } from 'next/server';
import { queryRows, queryOne } from '@/lib/db';
import { TDSCategory } from '@/types/database';
import { withPremiumSubscriptionApi } from '@/lib/security/premium-module-api';

export const dynamic = 'force-dynamic';

/**
 * GET /api/tds/categories
 * List TDS categories
 */
export const GET = withPremiumSubscriptionApi({}, async ({ businessId }) => {
  try {
    const categories = await queryRows<TDSCategory>(`
      SELECT * FROM tds_categories
      WHERE business_id = $1
      ORDER BY section_code
    `, [businessId]);

    return NextResponse.json({ categories });
  } catch (error: any) {
    console.error('Error fetching TDS categories:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
});

/**
 * POST /api/tds/categories
 * Create TDS category
 */
export const POST = withPremiumSubscriptionApi(
  { parseJsonBody: true },
  async ({ body, businessId }) => {
    try {
      const {
        section_code,
        section_name,
        description,
        rate,
        threshold_amount = 0,
      } = (body ?? {}) as Record<string, unknown>;

      if (!section_code || !section_name || rate === undefined) {
        return NextResponse.json(
          { error: 'section_code, section_name, and rate are required' },
          { status: 400 }
        );
      }

      // Check if section code already exists
      const existing = await queryOne(
        'SELECT id FROM tds_categories WHERE business_id = $1 AND section_code = $2',
        [businessId, section_code]
      );

      if (existing) {
        return NextResponse.json(
          { error: 'TDS category with this section code already exists' },
          { status: 409 }
        );
      }

      const category = await queryOne<TDSCategory>(
        `INSERT INTO tds_categories (
        business_id, section_code, section_name, description, rate, threshold_amount
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *`,
        [businessId, section_code, section_name, description || null, rate, threshold_amount]
      );

      return NextResponse.json({ category }, { status: 201 });
    } catch (error: any) {
      console.error('Error creating TDS category:', error);
      return NextResponse.json(
        { error: error.message || 'Internal server error' },
        { status: 500 }
      );
    }
  },
);
