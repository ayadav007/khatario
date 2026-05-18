import { NextRequest, NextResponse } from 'next/server';
import {
  getUserIdFromRequest,
  getBusinessIdFromRequest,
  requirePortalSession,
} from '@/lib/auth-helpers';
import { queryRows, queryOne } from '@/lib/db';

/**
 * GET /api/settings/activity-logs
 * Get activity logs for a business
 */
export async function GET(request: NextRequest) {
  try {
    const gate = await requirePortalSession(request);
    if (gate) return gate;

    const { searchParams } = new URL(request.url);
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);
    const module = searchParams.get('module');
    const limit = searchParams.get('limit') || '50';
    const offset = searchParams.get('offset') || '0';

    if (!businessId) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    let whereClause = 'WHERE ual.business_id = $1';
    const values: any[] = [businessId];
    let paramIndex = 2;

    if (userId) {
      whereClause += ` AND ual.user_id = $${paramIndex++}`;
      values.push(userId);
    }

    if (module) {
      whereClause += ` AND ual.module = $${paramIndex++}`;
      values.push(module);
    }

    values.push(parseInt(limit));
    values.push(parseInt(offset));

    const logs = await queryRows(`
      SELECT 
        ual.id,
        ual.business_id,
        ual.user_id,
        ual.user_name,
        ual.action,
        ual.module,
        ual.entity_type,
        ual.entity_id,
        ual.details,
        ual.ip_address,
        ual.created_at,
        u.name as current_user_name,
        u.phone as user_phone
      FROM user_activity_logs ual
      LEFT JOIN users u ON ual.user_id = u.id
      ${whereClause}
      ORDER BY ual.created_at DESC
      LIMIT $${paramIndex++} OFFSET $${paramIndex++}
    `, values);

    // Get total count
    const countResult = await queryOne(`
      SELECT COUNT(*) as total
      FROM user_activity_logs ual
      ${whereClause}
    `, values.slice(0, -2));

    return NextResponse.json({
      logs,
      total: parseInt(countResult?.total || '0'),
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
  } catch (error: any) {
    console.error('Error fetching activity logs:', error);
    return NextResponse.json(
      { error: 'Failed to fetch activity logs', details: error.message },
      { status: 500 }
    );
  }
}

