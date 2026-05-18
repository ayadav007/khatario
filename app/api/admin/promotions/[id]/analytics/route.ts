import { NextRequest, NextResponse } from 'next/server';
import { queryRows, queryOne } from '@/lib/db';
import { requirePlatformRequest } from '@/lib/platform-request-auth';

/**
 * GET /api/admin/promotions/[id]/analytics
 * Get detailed analytics for a promotion (Admin only)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = await requirePlatformRequest(request, 'admin');
    if (!auth.ok) return auth.response;

    const id = params.id;

    // 1. Basic counts
    const stats = await queryOne(`
      SELECT 
        COUNT(viewed_at) as total_views,
        COUNT(clicked_at) as total_clicks,
        COUNT(dismissed_at) as total_dismissals,
        COUNT(DISTINCT business_id) as unique_businesses
      FROM promotion_views
      WHERE promotion_id = $1
    `, [id]);

    // 2. Views by day (last 30 days)
    const dailyViews = await queryRows(`
      SELECT 
        DATE(viewed_at) as date,
        COUNT(*) as count
      FROM promotion_views
      WHERE promotion_id = $1 AND viewed_at >= CURRENT_DATE - INTERVAL '30 days'
      GROUP BY DATE(viewed_at)
      ORDER BY date ASC
    `, [id]);

    // 3. Plan breakdown
    const planBreakdown = await queryRows(`
      SELECT 
        bs.plan_id,
        COUNT(v.id) as view_count
      FROM promotion_views v
      JOIN business_subscriptions bs ON v.business_id = bs.business_id
      WHERE v.promotion_id = $1 AND bs.status IN ('active', 'trial')
      GROUP BY bs.plan_id
    `, [id]);

    return NextResponse.json({
      summary: stats,
      daily_views: dailyViews,
      plan_breakdown: planBreakdown
    });
  } catch (error: any) {
    console.error('Error fetching promotion analytics:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

