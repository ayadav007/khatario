import { NextRequest, NextResponse } from 'next/server';
import { getSessionScopedBusinessId } from '@/lib/auth-helpers';
import { getFeatureAccessInfo } from '@/lib/subscription/feature-access-info';
import { getFeatureRequiredModule } from '@/lib/subscription/module-entitlements';
import { productLineForModule } from '@/lib/subscription/plan-module';
import { currentTierPlans } from '@/lib/subscription/plan-offers';

export const dynamic = 'force-dynamic';

/**
 * GET /api/subscriptions/feature-plan
 * Which plan(s) an upgrade prompt may name for a feature (via subscription_plan_features): plans on sale
 * (never a hidden plan), with a price (never a free plan), of the feature's product, and above the plan the
 * business is on now. The first is the lowest tier, the cheapest of those on equal tier.
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

    const owner = getFeatureRequiredModule(featureKey);
    const productLine = owner ? productLineForModule(owner) : null;
    const current = await currentTierPlans(getSessionScopedBusinessId(request), productLine);
    const info = await getFeatureAccessInfo(featureKey, { onSaleOnly: true, productLine, current });

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
