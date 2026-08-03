import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import {getUserIdFromRequest, requirePortalSession, requireTenantBusinessId } from '@/lib/auth-helpers';

export const dynamic = 'force-dynamic';

/**
 * PATCH /api/notifications/read-all
 * Mark all notifications as read for a business and the JWT user.
 * Accepts business_id in request body or query params.
 */
export async function PATCH(request: NextRequest) {
  try {
    const gate = await requirePortalSession(request);
    if (gate) return gate;

    const userId = getUserIdFromRequest(request);
    if (!userId) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    let businessId: string;

    try {
      const body = await request.json();
      const tenant = requireTenantBusinessId(request, body.business_id);
      if (!tenant.ok) return tenant.response;
      businessId = tenant.businessId;
    } catch {
      const { searchParams } = new URL(request.url);
      const tenant = requireTenantBusinessId(request, searchParams.get('business_id'));
      if (!tenant.ok) return tenant.response;
      businessId = tenant.businessId;
    }

    // Build update query - if user_id provided, only mark that user's notifications as read
    let updateQuery = `
      UPDATE notifications
      SET is_read = true, read_at = NOW()
      WHERE business_id = $1 AND is_read = false
    `;
    const params: any[] = [businessId];

    updateQuery += ` AND (user_id = $2 OR user_id IS NULL)`;
    params.push(userId);

    await query(updateQuery, params);

    return NextResponse.json({ 
      success: true,
      message: 'All notifications marked as read'
    });
  } catch (error: any) {
    console.error('Error marking all notifications as read:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

