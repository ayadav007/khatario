import { NextRequest, NextResponse } from 'next/server';
import * as db from '@/lib/db';
import { requirePlatformRequest } from '@/lib/platform-request-auth';

/**
 * GET /api/admin/limits
 * 
 * Returns all platform limits grouped by category.
 * Used by admin UI to display limits registry.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requirePlatformRequest(request, 'viewer', 'can_manage_subscriptions');
    if (!auth.ok) return auth.response;

    const limits = await db.query(
      `SELECT 
        limit_key,
        category,
        label,
        description,
        unit,
        default_value,
        min_value,
        max_value,
        is_active,
        sort_order
      FROM platform_limits 
      WHERE is_active = true 
      ORDER BY category, sort_order`
    );

    // Group by category
    const grouped = limits.rows.reduce((acc: any, l: any) => {
      if (!acc[l.category]) {
        acc[l.category] = [];
      }
      acc[l.category].push({
        limit_key: l.limit_key,
        label: l.label,
        description: l.description,
        unit: l.unit,
        default_value: l.default_value,
        min_value: l.min_value,
        max_value: l.max_value,
        sort_order: l.sort_order
      });
      return acc;
    }, {});

    return NextResponse.json({
      limits: grouped,
      categories: Object.keys(grouped)
    });
  } catch (error: any) {
    console.error('Error fetching platform limits:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch limits' },
      { status: 500 }
    );
  }
}
