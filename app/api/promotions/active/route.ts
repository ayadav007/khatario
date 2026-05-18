import { NextRequest, NextResponse } from 'next/server';
import { queryRows, queryOne } from '@/lib/db';

/**
 * GET /api/promotions/active?business_id=xxx&type=banner
 * Fetches active promotions targeted at a specific business
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = searchParams.get('business_id');
    const type = searchParams.get('type'); // optional: banner, carousel, modal, sidebar

    if (!businessId) {
      return NextResponse.json({ error: 'business_id is required' }, { status: 400 });
    }

    // 1. Get current business subscription plan
    const sub = await queryOne<{ plan_id: string }>(
      `SELECT plan_id FROM business_subscriptions 
       WHERE business_id = $1 AND status IN ('active', 'trial')
       ORDER BY created_at DESC
       LIMIT 1`,
      [businessId]
    );

    const planId = sub?.plan_id || 'free';

    // 2. Fetch active promotions
    // Conditions:
    // - is_active is true
    // - Current time within start_date and end_date (if set)
    // - Target audience matches (all or specific plan)
    // - Business not in exclusion list
    // - If show_once_per_business, business hasn't viewed/dismissed it already
    
    let query = `
      SELECT p.* 
      FROM platform_promotions p
      WHERE p.is_active = true
        AND (p.start_date IS NULL OR p.start_date <= CURRENT_TIMESTAMP)
        AND (p.end_date IS NULL OR p.end_date >= CURRENT_TIMESTAMP)
        AND (p.target_audience = 'all' OR p.target_audience = $2)
        AND NOT ($1 = ANY(p.exclude_business_ids))
    `;

    const params: any[] = [businessId, planId];

    if (type) {
      query += ` AND p.message_type = $3`;
      params.push(type);
    }

    // Filter out dismissed promotions if they are set to show only once
    // For modals, we only check dismissals (not views) since viewing happens when modal opens
    query += `
      AND (
        p.show_once_per_business = false 
        OR NOT EXISTS (
          SELECT 1 FROM promotion_views v 
          WHERE v.promotion_id = p.id 
            AND v.business_id = $1
            AND v.dismissed_at IS NOT NULL
        )
      )
    `;

    // Order by priority then display position
    query += ` ORDER BY p.priority DESC, p.display_position ASC`;

    const promotions = await queryRows(query, params);

    // Debug logging (remove in production if needed)
    console.log('[Promotions API] Business ID:', businessId);
    console.log('[Promotions API] Plan ID:', planId);
    console.log('[Promotions API] Type filter:', type);
    console.log('[Promotions API] Found promotions:', promotions.length);

    return NextResponse.json({ promotions });
  } catch (error: any) {
    console.error('Error fetching active promotions:', error);
    return NextResponse.json(
      { error: 'Failed to fetch promotions', details: error.message },
      { status: 500 }
    );
  }
}

