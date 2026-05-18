import { NextRequest, NextResponse } from 'next/server';
import { queryRows, queryOne, query } from '@/lib/db';
import { CommissionRule } from '@/types/database';

/**
 * GET /api/commission-rules
 * List all commission rules for a business
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = searchParams.get('business_id');
    const employeeId = searchParams.get('employee_id');
    const roleId = searchParams.get('role_id');
    const activeOnly = searchParams.get('active_only') === 'true';

    if (!businessId) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    let sql = `
      SELECT 
        cr.*,
        e.employee_code,
        e.designation,
        u.name as employee_name,
        ur.role_name,
        ur.role_key
      FROM commission_rules cr
      LEFT JOIN employees e ON cr.employee_id = e.id
      LEFT JOIN users u ON e.id = u.id
      LEFT JOIN user_roles ur ON cr.role_id = ur.id
      WHERE cr.business_id = $1
    `;
    const params: any[] = [businessId];
    let paramIndex = 2;

    if (employeeId) {
      sql += ` AND cr.employee_id = $${paramIndex}`;
      params.push(employeeId);
      paramIndex++;
    }

    if (roleId) {
      sql += ` AND cr.role_id = $${paramIndex}`;
      params.push(roleId);
      paramIndex++;
    }

    if (activeOnly) {
      sql += ` AND cr.is_active = true
               AND (cr.effective_from IS NULL OR cr.effective_from <= CURRENT_DATE)
               AND (cr.effective_to IS NULL OR cr.effective_to >= CURRENT_DATE)`;
    }

    sql += ` ORDER BY cr.created_at DESC`;

    const rules = await queryRows<CommissionRule & {
      employee_code?: string;
      employee_name?: string;
      designation?: string;
      role_name?: string;
      role_key?: string;
    }>(sql, params);

    return NextResponse.json({ rules });
  } catch (error: any) {
    console.error('Error fetching commission rules:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/commission-rules
 * Create a new commission rule
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      business_id,
      employee_id,
      role_id,
      commission_type,
      commission_value,
      min_sale_amount = 0,
      max_commission,
      applies_to_item_category,
      applies_to_customer_type,
      effective_from,
      effective_to,
    } = body;

    if (!business_id || !commission_type || !commission_value) {
      return NextResponse.json(
        { error: 'business_id, commission_type, and commission_value are required' },
        { status: 400 }
      );
    }

    if (!employee_id && !role_id) {
      return NextResponse.json(
        { error: 'Either employee_id or role_id is required' },
        { status: 400 }
      );
    }

    if (employee_id && role_id) {
      return NextResponse.json(
        { error: 'Cannot specify both employee_id and role_id' },
        { status: 400 }
      );
    }

    // Validate commission_type
    if (!['percentage', 'fixed', 'tiered'].includes(commission_type)) {
      return NextResponse.json(
        { error: 'commission_type must be percentage, fixed, or tiered' },
        { status: 400 }
      );
    }

    // Validate commission_value
    if (commission_type === 'percentage' && (commission_value < 0 || commission_value > 100)) {
      return NextResponse.json(
        { error: 'commission_value for percentage must be between 0 and 100' },
        { status: 400 }
      );
    }

    if (commission_type === 'fixed' && commission_value < 0) {
      return NextResponse.json(
        { error: 'commission_value for fixed must be positive' },
        { status: 400 }
      );
    }

    const rule = await queryOne<CommissionRule>(
      `INSERT INTO commission_rules (
        business_id, employee_id, role_id, commission_type, commission_value,
        min_sale_amount, max_commission, applies_to_item_category,
        applies_to_customer_type, effective_from, effective_to
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *`,
      [
        business_id,
        employee_id || null,
        role_id || null,
        commission_type,
        commission_value,
        min_sale_amount,
        max_commission || null,
        applies_to_item_category || null,
        applies_to_customer_type || null,
        effective_from || null,
        effective_to || null,
      ]
    );

    return NextResponse.json({ rule }, { status: 201 });
  } catch (error: any) {
    console.error('Error creating commission rule:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

