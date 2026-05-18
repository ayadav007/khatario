import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, getBusinessIdFromRequest, resolveCreatedByUserId } from '@/lib/auth-helpers';
import { queryRows, queryOne, query } from '@/lib/db';
import { Employee } from '@/types/database';
import { checkLimit } from '@/lib/subscription';
import { authorize, AuthorizationError } from '@/lib/authorization';
import bcrypt from 'bcryptjs';
import { normalizePhoneOrNull } from '@/lib/utils/phone';

/**
 * GET /api/employees
 * List all employees for a business
 * 
 * NOTE: Employees are BUSINESS-SCOPED, not BRANCH-SCOPED.
 * This endpoint filters by business_id only and does NOT require or use branch_id.
 * HR modules (employees, attendance, leaves, etc.) are scoped to the entire business,
 * not individual branches.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request); // REQUIRED for authorization
    const search = searchParams.get('search') || '';
    const status = searchParams.get('status'); // 'active', 'inactive', or null for all
    const accessType = searchParams.get('access_type'); // 'full', 'attendance_only', or null for all

    if (!businessId) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    if (!userId) {
      return NextResponse.json(
        { error: 'user_id is required for authorization' },
        { status: 400 }
      );
    }

    // AUTHORIZATION: Check read permission (employees are part of HR module)
    // Note: Only businessId is passed - no branch context needed for HR endpoints
    try {
      await authorize(userId, 'employees', 'read', { businessId });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    // Build query - filtered by business_id only (not branch_id)
    // Employees are business-scoped resources
    let sql = `
      SELECT 
        e.*,
        u.name as user_name,
        u.email as user_email,
        u.phone as user_phone,
        u.is_active as user_is_active,
        rm_user.name as reporting_manager_name,
        rm.employee_code as reporting_manager_code
      FROM employees e
      INNER JOIN users u ON e.id = u.id
      LEFT JOIN employees rm ON e.reporting_manager_id = rm.id
      LEFT JOIN users rm_user ON rm.id = rm_user.id
      WHERE e.business_id = $1
    `;
    const params: any[] = [businessId];

    // Add search filter
    if (search) {
      sql += ` AND (
        e.employee_code ILIKE $${params.length + 1} OR
        u.name ILIKE $${params.length + 1} OR
        u.phone ILIKE $${params.length + 1} OR
        e.designation ILIKE $${params.length + 1} OR
        e.department ILIKE $${params.length + 1}
      )`;
      params.push(`%${search}%`);
    }

    // Add status filter
    if (status === 'active') {
      sql += ` AND e.is_active = true AND u.is_active = true`;
    } else if (status === 'inactive') {
      sql += ` AND (e.is_active = false OR u.is_active = false)`;
    }

    // Add access type filter
    if (accessType) {
      sql += ` AND e.access_type = $${params.length + 1}`;
      params.push(accessType);
    }

    // Get total count for pagination
    const countParams = params.slice(0, params.length);
    const countSql = sql.replace(/SELECT[\s\S]*?FROM/, 'SELECT COUNT(*) as total FROM');
    const countResult = await queryOne<{ total: string | number }>(countSql, countParams);
    // PostgreSQL COUNT(*) returns bigint as string - convert to number
    const total = parseInt(String(countResult?.total || '0'), 10);

    // Add pagination with validation
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1);
    const limit = Math.max(1, Math.min(100, parseInt(searchParams.get('limit') || '50', 10) || 50));
    const offset = (page - 1) * limit;

    sql += ` ORDER BY e.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const employees = await queryRows<Employee & {
      user_name: string;
      user_email?: string;
      user_phone: string;
      user_is_active: boolean;
      reporting_manager_name?: string;
      reporting_manager_code?: string;
    }>(sql, params);

    return NextResponse.json({ 
      employees,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error: any) {
    console.error('Error fetching employees:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/employees
 * Create a new employee
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      business_id,
      name,
      email,
      phone,
      password, // Optional, only for full access employees
      employee_code, // Optional, will auto-generate if not provided
      designation,
      department,
      joining_date,
      reporting_manager_id,
      employment_type = 'full_time',
      access_type = 'full',
      salary,
      photo_url,
      emergency_contact_name,
      emergency_contact_phone,
      bank_account_number,
      bank_ifsc,
      bank_name,
      pan_number,
      aadhaar_number,
      role_id, // Optional, for role assignment
    } = body;
    const createdByUserId = resolveCreatedByUserId(request, body);

    if (!business_id || !name || !phone) {
      return NextResponse.json(
        { error: 'business_id, name, and phone are required' },
        { status: 400 }
      );
    }

    const phoneNorm = normalizePhoneOrNull(phone);
    if (!phoneNorm) {
      return NextResponse.json(
        { error: 'Invalid phone number' },
        { status: 400 }
      );
    }

    const emergencyPhoneNorm = normalizePhoneOrNull(emergency_contact_phone);

    if (!createdByUserId) {
      return NextResponse.json(
        { error: 'created_by_user_id is required for authorization' },
        { status: 400 }
      );
    }

    // AUTHORIZATION: Check create permission (employees are part of HR module)
    try {
      await authorize(createdByUserId, 'employees', 'create', { businessId: business_id });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    // Check subscription limits
    const limitCheck = await checkLimit(business_id, 'employees');
    if (!limitCheck.allowed) {
      return NextResponse.json(
        {
          error: limitCheck.message || 'Employee limit reached',
          limit: limitCheck.limit,
          current: limitCheck.current,
          code: 'SUBSCRIPTION_LIMIT_EXCEEDED',
        },
        { status: 403 }
      );
    }

    // Check if user already exists with this phone/email
    const existingUser = await queryOne(
      `SELECT id FROM users WHERE (phone = $1 OR email = $2) AND business_id = $3`,
      [phoneNorm, email || '', business_id]
    );

    let userId: string;

    if (existingUser) {
      // Link to existing user
      userId = existingUser.id;

      // Check if employee record already exists
      const existingEmployee = await queryOne(
        'SELECT id FROM employees WHERE id = $1',
        [userId]
      );

      if (existingEmployee) {
        return NextResponse.json(
          { error: 'Employee already exists for this user' },
          { status: 400 }
        );
      }
    } else {
      // Create new user
      // Employees are attendance-only, so password is not required
      // Only users (with console access) need passwords

      const passwordHash = password ? await bcrypt.hash(password, 10) : null;

      const user = await queryOne<{ id: string }>(
        `INSERT INTO users (
          business_id, name, email, phone, password_hash, role, is_active
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id`,
        [
          business_id,
          name,
          email || null,
          phoneNorm,
          passwordHash,
          'user',
          true,
        ]
      );

      if (!user) {
        return NextResponse.json(
          { error: 'User not found' },
          { status: 404 }
        );
      }
      userId = user.id;

      // Note: Employees don't get roles - they are attendance-only
      // Only users (with console access) get roles
    }

    // Generate employee code if not provided
    let finalEmployeeCode = employee_code;
    if (!finalEmployeeCode) {
      const generatedCode = await queryOne<{ generate_employee_code: string }>(
        'SELECT generate_employee_code($1) as generate_employee_code',
        [business_id]
      );
      if (!generatedCode) {
        return NextResponse.json(
          { error: 'Failed to generate employee code' },
          { status: 500 }
        );
      }
      finalEmployeeCode = generatedCode.generate_employee_code;
    } else {
      // Check if employee code already exists
      const codeExists = await queryOne(
        'SELECT id FROM employees WHERE business_id = $1 AND employee_code = $2',
        [business_id, finalEmployeeCode]
      );
      if (codeExists) {
        return NextResponse.json(
          { error: `Employee code "${finalEmployeeCode}" already exists` },
          { status: 400 }
        );
      }
    }

    // Create employee record
    const employee = await queryOne<Employee>(
      `INSERT INTO employees (
        id, business_id, employee_code, designation, department, joining_date,
        reporting_manager_id, employment_type, access_type, salary, photo_url,
        emergency_contact_name, emergency_contact_phone, bank_account_number,
        bank_ifsc, bank_name, pan_number, aadhaar_number
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
      RETURNING *`,
      [
        userId,
        business_id,
        finalEmployeeCode,
        designation || null,
        department || null,
        joining_date || null,
        reporting_manager_id || null,
        employment_type,
        access_type,
        salary || null,
        photo_url || null,
        emergency_contact_name || null,
        emergencyPhoneNorm,
        bank_account_number || null,
        bank_ifsc || null,
        bank_name || null,
        pan_number || null,
        aadhaar_number || null,
      ]
    );

    if (!employee) {
      return NextResponse.json(
        { error: 'Failed to create employee' },
        { status: 500 }
      );
    }

    // Fetch complete employee data with user info
    const completeEmployee = await queryOne<Employee & {
      user_name: string;
      user_email?: string;
      user_phone: string;
    }>(
      `SELECT 
        e.*,
        u.name as user_name,
        u.email as user_email,
        u.phone as user_phone
      FROM employees e
      INNER JOIN users u ON e.id = u.id
      WHERE e.id = $1`,
      [employee.id]
    );

    return NextResponse.json({ employee: completeEmployee }, { status: 201 });
  } catch (error: any) {
    console.error('Error creating employee:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

