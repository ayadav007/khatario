import { NextRequest, NextResponse } from 'next/server';
import * as db from '@/lib/db';
import { requirePlatformRequest } from '@/lib/platform-request-auth';

/**
 * GET /api/admin/reports
 * Get all report definitions grouped by category
 *
 * Intentionally unauthenticated: main app Sidebar loads this to map report routes to features.
 */
export async function GET(request: NextRequest) {
  try {
    // Check if table exists first
    const tableExists = await db.queryOne(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'report_definitions'
      ) as exists
    `);

    if (!tableExists || !tableExists.exists) {
      // Table doesn't exist yet - return empty result (migration not run)
      return NextResponse.json({
        reports: {},
        total: 0,
        categories: [],
        message: 'Report definitions table not found. Please run migration 133_report_definitions_table.sql'
      });
    }

    const reports = await db.queryRows(`
      SELECT 
        id,
        name,
        description,
        route_path,
        category,
        report_type,
        is_active,
        sort_order,
        created_at,
        updated_at
      FROM report_definitions
      ORDER BY category, sort_order, name
    `);

    // Group by category
    const grouped = reports.reduce((acc: any, report: any) => {
      if (!acc[report.category]) {
        acc[report.category] = [];
      }
      acc[report.category].push(report);
      return acc;
    }, {});

    return NextResponse.json({
      reports: grouped,
      total: reports.length,
      categories: Object.keys(grouped)
    });
  } catch (error: any) {
    console.error('Error fetching reports:', error);
    // If it's a "table doesn't exist" error, return empty result gracefully
    if (error.code === '42P01' || error.message?.includes('does not exist')) {
      return NextResponse.json({
        reports: {},
        total: 0,
        categories: [],
        message: 'Report definitions table not found. Please run migration 133_report_definitions_table.sql'
      });
    }
    return NextResponse.json(
      { error: error.message || 'Failed to fetch reports' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/reports
 * Create or update a report definition
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requirePlatformRequest(request, 'viewer', 'can_manage_plans');
    if (!auth.ok) return auth.response;

    const body = await request.json();
    const {
      id,
      name,
      description,
      route_path,
      category,
      report_type,
      is_active = true,
      sort_order = 0
    } = body;

    if (!id || !name || !route_path || !category) {
      return NextResponse.json(
        { error: 'Missing required fields: id, name, route_path, category' },
        { status: 400 }
      );
    }

    if (!['basic', 'gst', 'advanced'].includes(category)) {
      return NextResponse.json(
        { error: 'Invalid category. Must be: basic, gst, or advanced' },
        { status: 400 }
      );
    }

    const report = await db.queryOne(`
      INSERT INTO report_definitions (
        id, name, description, route_path, category, report_type, is_active, sort_order
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        route_path = EXCLUDED.route_path,
        category = EXCLUDED.category,
        report_type = EXCLUDED.report_type,
        is_active = EXCLUDED.is_active,
        sort_order = EXCLUDED.sort_order,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `, [id, name, description || null, route_path, category, report_type || null, is_active, sort_order]);

    return NextResponse.json({ report }, { status: 201 });
  } catch (error: any) {
    console.error('Error saving report:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to save report' },
      { status: 500 }
    );
  }
}
