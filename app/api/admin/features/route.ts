import { NextRequest, NextResponse } from 'next/server';
import * as db from '@/lib/db';
import { requirePlatformRequest } from '@/lib/platform-request-auth';

/**
 * GET /api/admin/features
 * 
 * Returns all platform features grouped by category.
 * Used by admin UI to display feature matrix.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requirePlatformRequest(request, 'viewer', 'can_manage_subscriptions');
    if (!auth.ok) return auth.response;

    const features = await db.query(
      `SELECT 
        id,
        category,
        label,
        description,
        icon_name,
        route_path,
        is_addon,
        is_active,
        sort_order,
        created_at
      FROM platform_features 
      WHERE is_active = true 
      ORDER BY category, sort_order`
    );

    // Group by category
    const grouped = features.rows.reduce((acc: any, f: any) => {
      if (!acc[f.category]) {
        acc[f.category] = [];
      }
      acc[f.category].push({
        id: f.id,
        label: f.label,
        description: f.description,
        icon_name: f.icon_name,
        route_path: f.route_path,
        is_addon: f.is_addon,
        sort_order: f.sort_order
      });
      return acc;
    }, {});

    return NextResponse.json({
      features: grouped,
      categories: Object.keys(grouped)
    });
  } catch (error: any) {
    console.error('Error fetching platform features:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch features' },
      { status: 500 }
    );
  }
}
