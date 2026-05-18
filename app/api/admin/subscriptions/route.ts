import { NextRequest, NextResponse } from 'next/server';
import * as db from '@/lib/db';
import { requirePlatformRequest } from '@/lib/platform-request-auth';

// Force dynamic rendering - never cache this route
// This ensures fresh data in production
export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * GET /api/admin/subscriptions
 * List all business subscriptions (platform admin only)
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requirePlatformRequest(request, 'viewer', 'can_manage_subscriptions');
    if (!auth.ok) return auth.response;

    const subscriptions = await db.queryRows(`
      SELECT 
        bs.business_id,
        b.name as business_name,
        sp.display_name as plan_name,
        sp.id as plan_code,
        bs.status,
        CASE 
          WHEN bs.end_date IS NOT NULL AND bs.end_date > bs.start_date THEN
            CASE 
              WHEN (bs.end_date - bs.start_date) <= 31 THEN 'monthly'
              ELSE 'yearly'
            END
          ELSE 'monthly'
        END as billing_cycle,
        bs.start_date::text as start_date,
        bs.end_date::text as end_date,
        CASE 
          WHEN bs.trial_end_date IS NOT NULL AND bs.trial_end_date > CURRENT_DATE THEN true
          ELSE false
        END as is_trial,
        bs.trial_end_date::text as trial_ends_at,
        COALESCE(sp.price_monthly, 0)::numeric as monthly_price,
        COALESCE(sp.price_yearly, 0)::numeric as yearly_price
      FROM business_subscriptions bs
      LEFT JOIN businesses b ON bs.business_id = b.id
      LEFT JOIN subscription_plans sp ON bs.plan_id = sp.id
      WHERE bs.business_id IS NOT NULL
      ORDER BY COALESCE(bs.start_date, bs.created_at) DESC NULLS LAST
    `);

    return NextResponse.json(
      { 
        subscriptions,
      },
      {
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0'
        }
      }
    );
  } catch (error: any) {
    console.error('Error fetching subscriptions:', error);
    return NextResponse.json(
      { error: 'Failed to fetch subscriptions', details: error.message },
      { status: 500 }
    );
  }
}

