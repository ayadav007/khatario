import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

/**
 * PATCH /api/notifications/[id]/read
 * Mark a notification as read
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    // Handle both sync and async params (Next.js 13+ uses async params)
    const resolvedParams = params instanceof Promise ? await params : params;
    const notificationId = resolvedParams.id;

    if (!notificationId) {
      return NextResponse.json(
        { error: 'Notification ID is required' },
        { status: 400 }
      );
    }

    console.log(`[Mark as Read] Marking notification ${notificationId} as read`);

    // Update the notification in the database
    const result = await query(
      `UPDATE notifications 
       SET is_read = true, read_at = NOW() 
       WHERE id = $1
       RETURNING id, is_read, read_at`,
      [notificationId]
    );

    console.log(`[Mark as Read] Updated notification ${notificationId}:`, result);

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
