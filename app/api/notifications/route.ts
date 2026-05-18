import { NextRequest, NextResponse } from 'next/server';
import { queryRows } from '@/lib/db';
import { getUserIdFromRequest, requirePortalSession } from '@/lib/auth-helpers';

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
    const businessId = searchParams.get('business_id');
    const limit = parseInt(searchParams.get('limit') || '20', 10);

    if (!businessId) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    // Build query: Get notifications for the user OR notifications without user_id (for all users)
    let query = `
      SELECT 
        id,
        business_id,
        user_id,
        type,
        title,
        message,
        reference_type,
        reference_id,
        is_read,
        created_at,
        read_at
      FROM notifications
      WHERE business_id = $1
    `;
    
    const params: any[] = [businessId];

    // Get notifications for this specific user OR notifications without user_id (broadcast to all)
    query += ` AND (user_id = $2 OR user_id IS NULL)`;
    params.push(userId);
    
    query += ` ORDER BY created_at DESC LIMIT $${params.length + 1}`;
    params.push(limit);

    const notifications = await queryRows(query, params);

    const unreadCount = notifications.filter((n: any) => !n.is_read).length;

    return NextResponse.json({ 
      notifications, 
      unreadCount,
      unread_count: unreadCount 
    });
  } catch (error: any) {
    console.error('Error fetching notifications:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
