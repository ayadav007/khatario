import { NextRequest } from 'next/server';
import { handleMarkAllNotificationsRead } from '@/lib/notifications/mark-all-read-handler';

export const dynamic = 'force-dynamic';

/**
 * POST /api/notifications/mark-all-read
 * Legacy alias of /api/notifications/read-all: session business and JWT user only.
 */
export async function POST(request: NextRequest) {
  return handleMarkAllNotificationsRead(request);
}
