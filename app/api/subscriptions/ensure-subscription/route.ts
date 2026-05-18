import { NextRequest, NextResponse } from 'next/server';
import { requireTenantBusinessId } from '@/lib/auth-helpers';
import { queryOne, query } from '@/lib/db';
import { clearSubscriptionCache } from '@/lib/subscription';

/**
 * POST /api/subscriptions/ensure-subscription
 * Ensure a business has a subscription (auto-assign free plan if missing)
 * This is a helper endpoint to ensure all businesses have subscriptions
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const tenant = requireTenantBusinessId(request, body.business_id);
    if (!tenant.ok) return tenant.response;
    const business_id = tenant.businessId;

    // Check if subscription already exists
    const existing = await queryOne(`
      SELECT id FROM business_subscriptions WHERE business_id = $1
    `, [business_id]);

    if (existing) {
      return NextResponse.json({ 
        success: true, 
        message: 'Subscription already exists' 
      });
    }

    // Check if free plan exists
    const freePlan = await queryOne(`SELECT id FROM subscription_plans WHERE id = 'free'`);

    if (!freePlan) {
      return NextResponse.json(
        { 
          error: 'Free plan not found. Please run the seed script first.',
          requires_seed: true
        },
        { status: 500 }
      );
    }

    // Check if business exists
    const business = await queryOne(`SELECT id FROM businesses WHERE id = $1`, [business_id]);

    if (!business) {
      return NextResponse.json(
        { error: 'Business not found' },
        { status: 404 }
      );
    }

    // Assign free plan
    const subscription = await queryOne(`
      INSERT INTO business_subscriptions (business_id, plan_id, status, start_date, trial_end_date)
      VALUES ($1, 'free', 'active', CURRENT_DATE, CURRENT_DATE + INTERVAL '30 days')
      RETURNING id, business_id, plan_id, status
    `, [business_id]);

    // Clear subscription cache so new subscription is immediately available
    clearSubscriptionCache(business_id);

    return NextResponse.json({ 
      success: true,
      subscription,
      message: 'Free plan assigned successfully' 
    });
  } catch (error: any) {
    console.error('Error ensuring subscription:', error);
    
    // Handle unique constraint violation (subscription already exists)
    if (error.code === '23505') {
      return NextResponse.json({ 
        success: true, 
        message: 'Subscription already exists' 
      });
    }

    return NextResponse.json(
      { error: 'Failed to ensure subscription', details: error.message },
      { status: 500 }
    );
  }
}

