import { NextRequest, NextResponse } from 'next/server';
import { listActiveSubscriptionPlans } from '@/lib/subscription/list-plans';

/**
 * GET /api/subscriptions/plans
 * List active plans for in-app upgrade / change-plan UI (authenticated business users).
 */
export async function GET(_request: NextRequest) {
  try {
    const plans = await listActiveSubscriptionPlans();
    return NextResponse.json({ plans });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Error fetching subscription plans:', error);
    return NextResponse.json(
      { error: 'Failed to fetch subscription plans', details: message },
      { status: 500 },
    );
  }
}
