import { NextRequest, NextResponse } from 'next/server';
import { queryRows } from '@/lib/db';
import {
  getUserIdFromRequest,
  requirePortalSession,
  requireTenantBusinessId,
} from '@/lib/auth-helpers';
import { dbStreamSource } from '@/lib/notifications/stream/catch-up';

export const dynamic = 'force-dynamic';

/**
 * GET /api/notifications?business_id=xxx&limit=20
 * Get notifications for a business; user is taken from JWT (x-authenticated-user-id).
 * Returns rows for that user (user_id match) or broadcast rows (user_id IS NULL).
 */
export async function GET(request: NextRequest) {
  try {
    const gate = await requirePortalSession(request);
    if (gate) return gate;

    const userId = getUserIdFromRequest(request);
    if (!userId) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const tenant = requireTenantBusinessId(request, searchParams.get('business_id'));
    if (!tenant.ok) {
      return tenant.response;
    }
    const businessId = tenant.businessId;
    const limit = parseInt(searchParams.get('limit') || '20', 10);

    // Own rows plus business-wide broadcasts (user_id IS NULL).
    const listSql = (extraColumns: string) => `
      SELECT
        id, business_id, user_id, type, title, message, reference_type, reference_id,
        is_read, created_at, read_at${extraColumns}
      FROM notifications
      WHERE business_id = $1 AND (user_id = $2 OR user_id IS NULL)
      ORDER BY created_at DESC
      LIMIT $3`;
    const params = [businessId, userId, limit];

    let notifications: any[];
    let streamCursor: string | null;
    try {
      // The list is capped and ordered by created_at, which does not follow seq order (created_at
      // is the transaction start or an app-supplied value; legacy NULLs sort first), so its max
      // seq is not a safe stream start. Read the latest visible seq with the stream's own query,
      // before the list: rows committing in between are then both listed and replayed (the
      // client drops the duplicate), and late commits at or below it are replayed by the stream.
      streamCursor = (await dbStreamSource.latestSeq({ businessId, userId })).toString();
      // popup_dismissed_at keeps dismissed reminders from re-popping.
      notifications = await queryRows(listSql(', seq::text AS seq, popup_dismissed_at'), params);
    } catch (error: any) {
      // Database without migration 337 yet: old shape and no cursor (the stream needs seq).
      if (error?.code !== '42703') throw error;
      streamCursor = null;
      notifications = await queryRows(listSql(''), params);
    }

    const unreadCount = notifications.filter((n: any) => !n.is_read).length;

    return NextResponse.json({ 
      notifications, 
      unreadCount,
      unread_count: unreadCount,
      stream_cursor: streamCursor,
    });
  } catch (error: any) {
    console.error('Error fetching notifications:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
