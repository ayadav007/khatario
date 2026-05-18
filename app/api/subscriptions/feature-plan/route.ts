import { NextRequest, NextResponse } from 'next/server';
import { getFeatureAccessInfo } from '@/lib/subscription/feature-access-info';

/**
 * GET /api/subscriptions/feature-plan
 * Get which plan(s) have a specific feature enabled (via subscription_plan_features).
 *
 * Query params:
 * - feature_key: The feature key to check (e.g. 'template_customization', 'party_pricing')
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const featureKey = searchParams.get('feature_key');

    if (!featureKey) {
      return NextResponse.json(
        { error: 'feature_key is required' },
        { status: 400 }
      );
    }

    const info = await getFeatureAccessInfo(featureKey);

    if (!info.lowestPlan || info.allPlans.length === 0) {
      return NextResponse.json({
        requiredPlan: null,
        message: 'Feature not available in any plan',
      });
    }

    const lowest = info.lowestPlan;

    return NextResponse.json({
      requiredPlan: {
        planId: lowest.planId,
        planName: lowest.planId,
        planDisplayName: lowest.displayName,
        planLabel: lowest.planLabel,
        priceMonthly: lowest.priceMonthly,
        allPlansWithFeature: info.allPlans.map((p) => ({
          planId: p.planId,
          planName: p.planId,
          planDisplayName: p.displayName,
          planLabel: p.planLabel,
          priceMonthly: p.priceMonthly,
        })),
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error fetching required plan for feature:', error);
    return NextResponse.json(
      { error: 'Failed to fetch required plan', details: message },
      { status: 500 }
    );
  }
}
