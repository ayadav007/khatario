import { NextRequest, NextResponse } from 'next/server';
import { queryRows, queryOne } from '@/lib/db';
import { EmployeePerformance } from '@/types/database';

/**
 * GET /api/employees/performance
 * Get performance metrics for employees
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = searchParams.get('business_id');
    const employeeId = searchParams.get('employee_id');
    const periodType = searchParams.get('period_type') || 'monthly'; // 'daily', 'weekly', 'monthly'
    const startDate = searchParams.get('start_date');
    const endDate = searchParams.get('end_date');

    if (!businessId) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    let sql = `
      SELECT 
        p.*,
        e.employee_code,
        u.name as employee_name,
        e.designation,
        et.target_amount,
        CASE 
          WHEN et.target_amount > 0 THEN ROUND((p.total_sales / et.target_amount * 100)::numeric, 2)
          ELSE NULL
        END as achievement_percentage
      FROM employee_performance p
      INNER JOIN employees e ON p.employee_id = e.id
      INNER JOIN users u ON e.id = u.id
      LEFT JOIN employee_targets et ON e.id = et.employee_id
        AND et.target_period = $1
        AND et.target_year = EXTRACT(YEAR FROM p.period_date)::INTEGER
        AND (et.target_month IS NULL OR et.target_month = EXTRACT(MONTH FROM p.period_date)::INTEGER)
      WHERE e.business_id = $2
    `;
    const params: any[] = [periodType, businessId];
    let paramIndex = 3;

    if (employeeId) {
      sql += ` AND p.employee_id = $${paramIndex}`;
      params.push(employeeId);
      paramIndex++;
    }

    sql += ` AND p.period_type = $1`;

    if (startDate) {
      sql += ` AND p.period_date >= $${paramIndex}`;
      params.push(startDate);
      paramIndex++;
    }

    if (endDate) {
      sql += ` AND p.period_date <= $${paramIndex}`;
      params.push(endDate);
      paramIndex++;
    }

    sql += ` ORDER BY p.period_date DESC, p.total_sales DESC`;

    const performance = await queryRows<EmployeePerformance & {
      employee_code: string;
      employee_name: string;
      designation?: string;
      achievement_percentage?: number;
    }>(sql, params);

    // Calculate summary statistics
    const summary = performance.reduce(
      (acc, perf) => {
        acc.totalSales += perf.total_sales;
        acc.totalInvoices += perf.total_invoices;
        acc.totalCommission += perf.total_commission;
        acc.totalEmployees = new Set([...acc.employeeIds, perf.employee_id]).size;
        acc.employeeIds.add(perf.employee_id);
        return acc;
      },
      {
        totalSales: 0,
        totalInvoices: 0,
        totalCommission: 0,
        totalEmployees: 0,
        employeeIds: new Set<string>(),
      }
    );

    return NextResponse.json({
      performance,
      summary: {
        totalSales: summary.totalSales,
        totalInvoices: summary.totalInvoices,
        totalCommission: summary.totalCommission,
        totalEmployees: summary.totalEmployees,
      },
    });
  } catch (error: any) {
    console.error('Error fetching performance:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

