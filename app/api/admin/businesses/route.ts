import { NextRequest, NextResponse } from 'next/server';
import * as db from '@/lib/db';
import { requirePlatformRequest } from '@/lib/platform-request-auth';
import { getEffectivePlanId } from '@/lib/subscription/effective-plan';

/**
 * GET /api/admin/businesses
 * List all businesses with search and pagination
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requirePlatformRequest(request, 'viewer', 'can_manage_businesses');
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search') || '';
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');
    const offset = (page - 1) * limit;

    let whereClause = '';
    const queryParams: any[] = [];
    let paramIndex = 1;

    if (search) {
      whereClause = `WHERE b.name ILIKE $${paramIndex} OR b.email ILIKE $${paramIndex} OR b.phone ILIKE $${paramIndex}`;
      queryParams.push(`%${search}%`);
      paramIndex++;
    }

    // Get total count
    const countResult = await db.queryOne(`
      SELECT COUNT(*) as count
      FROM businesses b
      ${whereClause}
    `, queryParams);
    const total = parseInt(countResult?.count || '0');

    // Get businesses with subscription info
    const businesses = await db.queryRows(`
      SELECT 
        b.id,
        b.name,
        b.email,
        b.phone,
        b.city,
        b.state,
        b.gstin,
        b.created_at,
        bs.plan_id,
        bs.status as subscription_status,
        bs.trial_end_date::text as trial_end_date,
        bs.end_date::text as subscription_end_date,
        bs.grace_period_end::text as grace_period_end,
        sp.display_name as plan_name,
        sp.price_monthly,
        (SELECT COUNT(*) FROM invoices WHERE business_id = b.id) as invoice_count,
        (SELECT COUNT(*) FROM customers WHERE business_id = b.id) as customer_count,
        (SELECT COUNT(*) FROM items WHERE business_id = b.id) as item_count,
        (SELECT MAX(created_at) FROM invoices WHERE business_id = b.id) as last_invoice_date
      FROM businesses b
      LEFT JOIN LATERAL (
        SELECT *
        FROM business_subscriptions bs2
        WHERE bs2.business_id = b.id
        ORDER BY
          CASE WHEN bs2.status IN ('active', 'trial') THEN 0 ELSE 1 END,
          bs2.updated_at DESC NULLS LAST
        LIMIT 1
      ) bs ON true
      LEFT JOIN subscription_plans sp ON bs.plan_id = sp.id
      ${whereClause}
      ORDER BY b.created_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `, [...queryParams, limit, offset]);

    const planLabels = await db.queryRows<{ id: string; display_name: string; price_monthly: number }>(
      `SELECT id, display_name, price_monthly FROM subscription_plans WHERE is_active = true`,
    );
    const planById = new Map(planLabels.map((p) => [p.id, p]));

    const enriched = businesses.map((row: Record<string, unknown>) => {
      const effectivePlanId = getEffectivePlanId({
        plan_id: String(row.plan_id || 'free'),
        status: String(row.subscription_status || 'active'),
        trial_end_date: row.trial_end_date as string | null,
        end_date: row.subscription_end_date as string | null,
        grace_period_end: row.grace_period_end as string | null,
      });
      const effective = planById.get(effectivePlanId);
      return {
        ...row,
        plan_id: effectivePlanId,
        plan_name: effective?.display_name || (effectivePlanId === 'free' ? 'Free' : row.plan_name),
        price_monthly: effective?.price_monthly ?? row.price_monthly,
        stored_plan_id: row.plan_id,
      };
    });

    return NextResponse.json({
      businesses: enriched,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error: any) {
    console.error('Error fetching businesses:', error);
    return NextResponse.json(
      { error: 'Failed to fetch businesses', details: error.message },
      { status: 500 }
    );
  }
}

