import { NextRequest } from 'next/server';
import { handleMarkAllNotificationsRead } from '@/lib/notifications/mark-all-read-handler';

export const dynamic = 'force-dynamic';

/**
 * PATCH /api/notifications/read-all
 * Mark all notifications as read for the session business and the JWT user.
 * Accepts business_id in request body or query params (must match the session).
 */
export async function PATCH(request: NextRequest) {
  return handleMarkAllNotificationsRead(request);
}

/** The web client sends POST; same behavior as PATCH. */
export async function POST(request: NextRequest) {
  return handleMarkAllNotificationsRead(request);
}
