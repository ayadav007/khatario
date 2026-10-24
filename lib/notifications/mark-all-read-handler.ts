import { NextRequest, NextResponse } from 'next/server';
import { requireTenantBusinessId } from '@/lib/auth-helpers';
import { requireNotificationSession } from '@/lib/notifications/notification-session';
import { markAllNotificationsRead } from '@/lib/notifications/read-state';

/**
 * Shared by PATCH/POST /api/notifications/read-all and POST /api/notifications/mark-all-read.
 * Marks the signed-in user's notifications (and broadcasts) in the session business only.
 * A `business_id` in the body or query is optional and must match the session.
 */
export async function handleMarkAllNotificationsRead(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await requireNotificationSession(request);
    if (!session.ok) return session.response;

    let claimedBusinessId: string | null = null;
    try {
      const body = await request.json();
      if (body && typeof body.business_id === 'string') claimedBusinessId = body.business_id;
    } catch {
      // no JSON body
    }
    if (!claimedBusinessId) {
      claimedBusinessId = new URL(request.url).searchParams.get('business_id');
    }
    const tenant = requireTenantBusinessId(request, claimedBusinessId);
    if (!tenant.ok) return tenant.response;

    await markAllNotificationsRead(session.businessId, session.userId);

    return NextResponse.json({
      success: true,
      message: 'All notifications marked as read',
    });
  } catch (error: any) {
    console.error('Error marking all notifications as read:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
