import { NextRequest, NextResponse } from 'next/server';
import {
  getUserIdFromRequest,
  getBusinessIdFromRequest,
  requirePortalSession,
} from '@/lib/auth-helpers';
import { queryRows } from '@/lib/db';
import { ActivityLog } from '@/types/database';

/**
 * GET /api/activity-logs
 * Get activity logs
 */
export async function GET(request: NextRequest) {
  try {
    const gate = await requirePortalSession(request);
    if (gate) return gate;

    const { searchParams } = new URL(request.url);
    const businessId = getBusinessIdFromRequest(request);
    const employeeId = searchParams.get('employee_id');
    const userId = getUserIdFromRequest(request);
    const module = searchParams.get('module');
    const actionType = searchParams.get('action_type');
    const startDate = searchParams.get('start_date');
    const endDate = searchParams.get('end_date');
    const limit = parseInt(searchParams.get('limit') || '100');

    if (!businessId) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    let sql = `
      SELECT 
        al.*,
        e.employee_code,
        u.name as user_name,
        u.email as user_email
      FROM activity_logs al
      LEFT JOIN employees e ON al.employee_id = e.id
      LEFT JOIN users u ON al.user_id = u.id
      WHERE al.business_id = $1
    `;
    const params: any[] = [businessId];
    let paramIndex = 2;

    if (employeeId) {
      sql += ` AND al.employee_id = $${paramIndex}`;
      params.push(employeeId);
      paramIndex++;
    }

    if (userId) {
      sql += ` AND al.user_id = $${paramIndex}`;
      params.push(userId);
      paramIndex++;
    }

    if (module) {
      sql += ` AND al.module = $${paramIndex}`;
      params.push(module);
      paramIndex++;
    }

    if (actionType) {
      sql += ` AND al.action_type = $${paramIndex}`;
      params.push(actionType);
      paramIndex++;
    }

    if (startDate) {
      sql += ` AND al.created_at >= $${paramIndex}`;
      params.push(startDate);
      paramIndex++;
    }

    if (endDate) {
      sql += ` AND al.created_at <= $${paramIndex}`;
      params.push(endDate);
      paramIndex++;
    }

    sql += ` ORDER BY al.created_at DESC LIMIT $${paramIndex}`;
    params.push(limit);

    const logs = await queryRows<ActivityLog & {
      employee_code?: string;
      user_name?: string;
      user_email?: string;
    }>(sql, params);

    return NextResponse.json({ logs });
  } catch (error: any) {
    console.error('Error fetching activity logs:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

