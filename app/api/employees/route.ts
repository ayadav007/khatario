import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, getBusinessIdFromRequest, resolveCreatedByUserId } from '@/lib/auth-helpers';
import { queryRows, queryOne, query } from '@/lib/db';
import { Employee } from '@/types/database';
import { checkLimit } from '@/lib/subscription';
import { authorize, AuthorizationError } from '@/lib/authorization';
import bcrypt from 'bcryptjs';
import { normalizePhoneOrNull } from '@/lib/utils/phone';
import { wouldCreateReportingCycle } from '@/lib/hr/manager-scope';
import {
  buildEmployeeScopeSql,
  getActorEmployeeId,
  resolveEmployeeListScope,
} from '@/lib/hr/employee-access-scope';
import {
  filterFieldsByPermission,
  rejectRestrictedFieldUpdates,
} from '@/lib/field-permission-filter';
import {
  sendEmployeePortalInvite,
  type PortalInviteChannel,
} from '@/lib/employee-portal/invite';
import { hasFeatureAccess } from '@/lib/subscription/feature-access';
import { generateNextEmployeeCode } from '@/lib/hr/employee-settings';
import { resolveEmployeeLoginDecision } from '@/lib/hr/employee-login-options';

export const dynamic = 'force-dynamic';

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

    const scopeParam = searchParams.get('scope');
    const listScope = await resolveEmployeeListScope(userId, businessId, scopeParam);
    const actorEmployeeId = await getActorEmployeeId(userId, businessId);

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

    const scopeFilter = buildEmployeeScopeSql(listScope, actorEmployeeId, params.length + 1);
    sql += scopeFilter.sql;
    params.push(...scopeFilter.params);

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

    const filteredEmployees = await filterFieldsByPermission(employees, userId, 'employees');

    return NextResponse.json({ 
      employees: filteredEmployees,
      scope: listScope,
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
      default_shift_id,
      joining_date,
      reporting_manager_id,
      employment_type = 'full_time',
      salary,
      pay_basis,
      photo_url,
      emergency_contact_name,
      emergency_contact_phone,
      bank_account_number,
      bank_ifsc,
      bank_name,
      pan_number,
      aadhaar_number,
      role_id, // Optional, for role assignment
      send_portal_invite,
      portal_invite_via = 'both',
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

    // Portal invite is optional. HR Lite (and plans without portal) still create the employee.
    let shouldSendPortalInvite = Boolean(send_portal_invite);
    if (shouldSendPortalInvite) {
      const portalEnabled = await hasFeatureAccess(business_id, 'hr_employee_portal');
      if (!portalEnabled) {
        shouldSendPortalInvite = false;
      }
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

    const { rejected: restrictedFields } = await rejectRestrictedFieldUpdates(
      createdByUserId,
      'employees',
      body
    );
    if (restrictedFields.length > 0) {
      return NextResponse.json(
        {
          error: 'You do not have permission to set restricted employee fields',
          fields: restrictedFields,
        },
        { status: 403 }
      );
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

    const existingLogin = await queryOne<{ role_id: string | null; is_primary_admin: boolean | null }>(
      `SELECT role_id, is_primary_admin FROM users WHERE phone = $1 AND business_id = $2`,
      [phoneNorm, business_id],
    );
    const loginDecision = await resolveEmployeeLoginDecision({
      businessId: business_id,
      actorUserId: createdByUserId,
      roleId: role_id,
      password,
      alreadyConsumesSeat: Boolean(existingLogin?.role_id || existingLogin?.is_primary_admin),
    });
    if (!loginDecision.ok) {
      return NextResponse.json(
        { error: loginDecision.error, code: loginDecision.code },
        { status: loginDecision.status },
      );
    }
    const effectiveAccessType = loginDecision.mode === 'login' || existingLogin?.is_primary_admin
      ? 'full'
      : 'attendance_only';
    const loginPasswordHash =
      loginDecision.mode === 'login' && typeof password === 'string' && password.trim()
        ? await bcrypt.hash(password.trim(), 10)
        : null;

    // Phone is unique inside this business. The same number may already exist at another business.
    const phoneOwner = await queryOne<{ id: string }>(
      `SELECT id FROM users WHERE phone = $1 AND business_id = $2`,
      [phoneNorm, business_id]
    );

    let existingUser: { id: string } | null = phoneOwner;

    if (!existingUser && typeof email === 'string' && email.trim()) {
      const emailOwner = await queryOne<{ id: string }>(
        `SELECT id FROM users WHERE lower(email) = lower($1) AND business_id = $2`,
        [email.trim(), business_id]
      );
      if (emailOwner) {
        return NextResponse.json(
          {
            error: 'This email is already used by someone in this business. Use a different email.',
            code: 'EMAIL_ALREADY_REGISTERED',
          },
          { status: 409 }
        );
      }
    }

    let userId: string;
    let reactivatedEmployee: Employee | null = null;

    if (existingUser) {
      userId = existingUser.id;

      const existingEmployee = await queryOne<{ id: string; is_active: boolean | null; employee_code: string }>(
        'SELECT id, is_active, employee_code FROM employees WHERE id = $1 AND business_id = $2',
        [userId, business_id]
      );

      if (existingEmployee && existingEmployee.is_active !== false) {
        return NextResponse.json(
          { error: 'Employee already exists for this user' },
          { status: 400 }
        );
      }

      if (existingEmployee) {
        if (reporting_manager_id) {
          const cycle = await wouldCreateReportingCycle(business_id, userId, reporting_manager_id);
          if (cycle) {
            return NextResponse.json(
              { error: 'Invalid reporting manager: would create a cycle in the org hierarchy' },
              { status: 400 }
            );
          }
        }

        let finalEmployeeCode = employee_code || existingEmployee.employee_code;
        if (employee_code && employee_code !== existingEmployee.employee_code) {
          const codeExists = await queryOne(
            'SELECT id FROM employees WHERE business_id = $1 AND employee_code = $2 AND id <> $3',
            [business_id, employee_code, userId]
          );
          if (codeExists) {
            return NextResponse.json(
              { error: `Employee code "${employee_code}" already exists` },
              { status: 400 }
            );
          }
        }

        await query(
          `UPDATE users
           SET name = $1,
               email = $2,
               is_active = true,
               role_id = $3,
               password_hash = COALESCE($4, password_hash),
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $5 AND business_id = $6 AND COALESCE(is_primary_admin, false) = false`,
          [
            name,
            email || null,
            loginDecision.mode === 'login' ? loginDecision.roleId : null,
            loginPasswordHash,
            userId,
            business_id,
          ]
        );
        await query(
          `UPDATE users
           SET name = $1, is_active = true, updated_at = CURRENT_TIMESTAMP
           WHERE id = $2 AND business_id = $3 AND COALESCE(is_primary_admin, false) = true`,
          [name, userId, business_id]
        );

        reactivatedEmployee = await queryOne<Employee>(
          `UPDATE employees SET
             employee_code = $1, designation = $2, department = $3, joining_date = $4,
             reporting_manager_id = $5, employment_type = $6, access_type = $7, salary = $8,
             pay_basis = $9, photo_url = $10, emergency_contact_name = $11, emergency_contact_phone = $12,
             bank_account_number = $13, bank_ifsc = $14, bank_name = $15, pan_number = $16,
             aadhaar_number = $17, default_shift_id = $18, is_active = true
           WHERE id = $19 AND business_id = $20
           RETURNING *`,
          [
            finalEmployeeCode,
            designation || null,
            department || null,
            joining_date || null,
            reporting_manager_id || null,
            employment_type,
            effectiveAccessType,
            salary || null,
            pay_basis === 'daily' ? 'daily' : 'monthly',
            photo_url || null,
            emergency_contact_name || null,
            emergencyPhoneNorm,
            bank_account_number || null,
            bank_ifsc || null,
            bank_name || null,
            pan_number || null,
            aadhaar_number || null,
            default_shift_id || null,
            userId,
            business_id,
          ]
        );
      }
    } else {
      // Create new user
      // Employees are attendance-only, so password is not required
      // Only users (with console access) need passwords

      const passwordHash = loginPasswordHash;

      const user = await queryOne<{ id: string }>(
        `INSERT INTO users (
          business_id, name, email, phone, password_hash, role_id, is_active
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id`,
        [
          business_id,
          name,
          email || null,
          phoneNorm,
          passwordHash,
          loginDecision.mode === 'login' ? loginDecision.roleId : null,
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
    if (!reactivatedEmployee) {
    if (!finalEmployeeCode) {
      finalEmployeeCode = await generateNextEmployeeCode(business_id);
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
    }

    if (reporting_manager_id) {
      const cycle = await wouldCreateReportingCycle(
        business_id,
        userId,
        reporting_manager_id
      );
      if (cycle) {
        return NextResponse.json(
          { error: 'Invalid reporting manager: would create a cycle in the org hierarchy' },
          { status: 400 }
        );
      }
    }

    // Create employee record
    const employee = reactivatedEmployee ?? await queryOne<Employee>(
      `INSERT INTO employees (
        id, business_id, employee_code, designation, department, joining_date,
        reporting_manager_id, employment_type, access_type, salary, pay_basis, photo_url,
        emergency_contact_name, emergency_contact_phone, bank_account_number,
        bank_ifsc, bank_name, pan_number, aadhaar_number, default_shift_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
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
        effectiveAccessType,
        salary || null,
        pay_basis === 'daily' ? 'daily' : 'monthly',
        photo_url || null,
        emergency_contact_name || null,
        emergencyPhoneNorm,
        bank_account_number || null,
        bank_ifsc || null,
        bank_name || null,
        pan_number || null,
        aadhaar_number || null,
        default_shift_id || null,
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

    if (!completeEmployee) {
      return NextResponse.json(
        { error: 'Failed to create employee' },
        { status: 500 }
      );
    }

    if (joining_date) {
      const { applyProbationOnJoin } = await import('@/lib/hr/probation-auto-confirm');
      await applyProbationOnJoin(business_id, employee.id, joining_date);
    }

    let portalInvite: Awaited<ReturnType<typeof sendEmployeePortalInvite>> | null = null;
    if (shouldSendPortalInvite) {
      const channels: PortalInviteChannel =
        portal_invite_via === 'email' || portal_invite_via === 'whatsapp'
          ? portal_invite_via
          : 'both';
      try {
        portalInvite = await sendEmployeePortalInvite({
          businessId: business_id,
          employeeId: completeEmployee.id,
          channels,
        });
      } catch (inviteError: unknown) {
        const message =
          inviteError instanceof Error
            ? inviteError.message
            : 'Portal invite failed after employee was created';
        portalInvite = {
          temporary_password: '',
          portal_url: '',
          employee_code: completeEmployee.employee_code,
          email_sent: false,
          whatsapp_sent: false,
          errors: [message],
        };
      }
    }

    return NextResponse.json(
      { employee: completeEmployee, portal_invite: portalInvite },
      { status: 201 }
    );
  } catch (error: any) {
    console.error('Error creating employee:', error);
    if (error?.code === '23505') {
      const constraint = String(error.constraint || '');
      const detail = String(error.detail || '');
      if (
        constraint === 'users_phone_key' ||
        constraint === 'uq_users_business_phone' ||
        detail.includes('(phone)')
      ) {
        return NextResponse.json(
          {
            error: 'This mobile number is already used in this business.',
            code: 'PHONE_ALREADY_REGISTERED',
          },
          { status: 409 }
        );
      }
      if (
        constraint === 'users_email_key' ||
        constraint === 'uq_users_business_email' ||
        detail.includes('(email)')
      ) {
        return NextResponse.json(
          {
            error: 'This email is already used in this business.',
            code: 'EMAIL_ALREADY_REGISTERED',
          },
          { status: 409 }
        );
      }
    }
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

