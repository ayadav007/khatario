import { NextRequest, NextResponse } from 'next/server';
import { queryRows, queryOne } from '@/lib/db';
import { requirePlatformRequest } from '@/lib/platform-request-auth';

/**
 * GET /api/admin/bookings?status=pending&search=john&page=1&limit=20
 * List all bookings with filters (Admin only)
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requirePlatformRequest(request, 'admin');
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const leadSource = searchParams.get('lead_source');
    const assignedAdminId = searchParams.get('assigned_admin_id');
    const search = searchParams.get('search');
    const startDate = searchParams.get('start_date');
    const endDate = searchParams.get('end_date');
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');
    const offset = (page - 1) * limit;

    let sql = `
      SELECT b.*, 
        pa.name as assigned_admin_name,
        pa.email as assigned_admin_email
      FROM demo_bookings b
      LEFT JOIN platform_admins pa ON b.assigned_admin_id = pa.id
      WHERE 1=1
    `;
    const params: any[] = [];
    let paramIndex = 1;

    if (status) {
      sql += ` AND b.status = $${paramIndex++}`;
      params.push(status);
    }

    if (leadSource) {
      sql += ` AND b.lead_source = $${paramIndex++}`;
      params.push(leadSource);
    }

    if (assignedAdminId) {
      sql += ` AND b.assigned_admin_id = $${paramIndex++}`;
      params.push(assignedAdminId);
    }

    if (search) {
      sql += ` AND (
        b.name ILIKE $${paramIndex} OR 
        b.email ILIKE $${paramIndex} OR 
        b.phone ILIKE $${paramIndex} OR 
        b.booking_number ILIKE $${paramIndex} OR
        b.company_name ILIKE $${paramIndex}
      )`;
      params.push(`%${search}%`);
      paramIndex++;
    }

    if (startDate) {
      sql += ` AND b.scheduled_date >= $${paramIndex++}`;
      params.push(startDate);
    }

    if (endDate) {
      sql += ` AND b.scheduled_date <= $${paramIndex++}`;
      params.push(endDate);
    }

    sql += ` ORDER BY b.created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
    params.push(limit, offset);

    const bookings = await queryRows(sql, params);

    // Get total count for pagination
    let countSql = `
      SELECT COUNT(*) as total
      FROM demo_bookings b
      WHERE 1=1
    `;
    const countParams: any[] = [];
    let countParamIndex = 1;

    if (status) {
      countSql += ` AND b.status = $${countParamIndex++}`;
      countParams.push(status);
    }
    if (leadSource) {
      countSql += ` AND b.lead_source = $${countParamIndex++}`;
      countParams.push(leadSource);
    }
    if (assignedAdminId) {
      countSql += ` AND b.assigned_admin_id = $${countParamIndex++}`;
      countParams.push(assignedAdminId);
    }
    if (search) {
      countSql += ` AND (
        b.name ILIKE $${countParamIndex} OR 
        b.email ILIKE $${countParamIndex} OR 
        b.phone ILIKE $${countParamIndex} OR 
        b.booking_number ILIKE $${countParamIndex} OR
        b.company_name ILIKE $${countParamIndex}
      )`;
      countParams.push(`%${search}%`);
      countParamIndex++;
    }
    if (startDate) {
      countSql += ` AND b.scheduled_date >= $${countParamIndex++}`;
      countParams.push(startDate);
    }
    if (endDate) {
      countSql += ` AND b.scheduled_date <= $${countParamIndex++}`;
      countParams.push(endDate);
    }

    const countResult = await queryOne<{ total: number }>(countSql, countParams);
    const total = parseInt(countResult?.total?.toString() || '0');

    return NextResponse.json({
      bookings,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error: any) {
    console.error('Error fetching bookings:', error);
    const status = error.message?.includes('Forbidden') || error.message?.includes('Insufficient') ? 403 : 500;
    return NextResponse.json({ error: error.message }, { status });
  }
}

