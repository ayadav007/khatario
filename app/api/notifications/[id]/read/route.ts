import { NextRequest, NextResponse } from 'next/server';
import { isUuid, requireNotificationSession } from '@/lib/notifications/notification-session';
import { markNotificationRead } from '@/lib/notifications/read-state';

export const dynamic = 'force-dynamic';

/**
 * PATCH /api/notifications/[id]/read
 * Mark one of the signed-in user's notifications (or a broadcast in the session business) as read.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const session = await requireNotificationSession(request);
    if (!session.ok) return session.response;

    // Handle both sync and async params (Next.js 13+ uses async params)
    const resolvedParams = params instanceof Promise ? await params : params;
    const notificationId = resolvedParams.id;

    if (!notificationId) {
      return NextResponse.json(
        { error: 'Notification ID is required' },
        { status: 400 }
      );
    }

    const updated =
      isUuid(notificationId) &&
      (await markNotificationRead(notificationId, session.businessId, session.userId));
    if (!updated) {
      return NextResponse.json({ error: 'Notification not found' }, { status: 404 });
    }

    return NextResponse.json({ 
      success: true,
      message: 'Notification marked as read'
    });
  } catch (error: any) {
    console.error('[Mark as Read] Error marking notification as read:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
