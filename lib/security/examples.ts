/**
 * Reference implementations — not wired to routes.
 * Copy patterns into route handlers during migration.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  assertOperationalSubscription,
  requireOperationalSubscription,
  withBusinessApi,
} from '@/lib/security';

// ---------------------------------------------------------------------------
// Example 1: Standalone subscription gate inside an existing handler
// ---------------------------------------------------------------------------
export async function exampleStandaloneSubscriptionCheck(
  request: NextRequest,
  businessId: string,
): Promise<NextResponse> {
  const sub = await assertOperationalSubscription(businessId);
  if (!sub.ok) {
    return sub.response;
  }

  // sub.subscription is typed BusinessSubscription
  return NextResponse.json({ plan: sub.subscription.plan_id });
}

// ---------------------------------------------------------------------------
// Example 2: Throwing variant (use with try/catch + operationalSubscriptionErrorResponse)
// ---------------------------------------------------------------------------
export async function exampleThrowingSubscriptionCheck(businessId: string) {
  const subscription = await requireOperationalSubscription(businessId);
  return subscription.plan_display_name;
}

// ---------------------------------------------------------------------------
// Example 3: GET route with path tenant id + RBAC + subscription (no feature)
// ---------------------------------------------------------------------------
export const exampleGetBusinessSettings = withBusinessApi<{ id: string }>(
  {
    module: 'settings',
    action: 'read',
    claimedBusinessId: ({ params }) => params.id,
  },
  async ({ businessId }) => {
    return NextResponse.json({ businessId });
  },
);

// ---------------------------------------------------------------------------
// Example 4: POST with body tenant claim, feature, and item limit
// ---------------------------------------------------------------------------
export const examplePostItemImport = withBusinessApi(
  {
    module: 'items',
    action: 'create',
    parseJsonBody: true,
    claimedBusinessId: ({ body }) =>
      body != null && typeof body === 'object'
        ? (body as { business_id?: string }).business_id
        : null,
    feature: 'inventory_items',
    limitType: 'items',
  },
  async ({ body, businessId, userId }) => {
    return NextResponse.json({ businessId, userId, itemCount: Array.isArray((body as { items?: unknown[] })?.items) ? (body as { items: unknown[] }).items.length : 0 });
  },
);

// ---------------------------------------------------------------------------
// Example 5: GST report route — report tier + RBAC module
// ---------------------------------------------------------------------------
export const exampleGstr2bReconcile = withBusinessApi(
  {
    module: 'report.gst',
    action: 'read',
    claimedBusinessId: ({ request }) =>
      new URL(request.url).searchParams.get('business_id'),
    report: 'gst',
  },
  async ({ request, businessId, userId }) => {
    const filingPeriod = new URL(request.url).searchParams.get('filing_period');
    return NextResponse.json({ businessId, userId, filingPeriod });
  },
);
