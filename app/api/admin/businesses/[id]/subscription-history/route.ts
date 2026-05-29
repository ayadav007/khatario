import { NextRequest, NextResponse } from 'next/server';
import { requirePlatformRequest } from '@/lib/platform-request-auth';
import {
  getSubscriptionEventsForAdmin,
  getTrialAdminSummary,
} from '@/lib/subscription/trial-admin-summary';

/**
 * GET /api/admin/businesses/[id]/subscription-history
 * Trial timeline + subscription_events audit for platform admins.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requirePlatformRequest(request, 'viewer', 'can_manage_subscriptions');
  if (!auth.ok) return auth.response;

  try {
    const [trial, events] = await Promise.all([
      getTrialAdminSummary(params.id),
      getSubscriptionEventsForAdmin(params.id),
    ]);

    return NextResponse.json({ trial, events });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Error fetching subscription history:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
