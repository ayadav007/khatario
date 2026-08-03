import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import { queryOne, query, queryRows } from '@/lib/db';
import { Employee } from '@/types/database';
import { authorize, AuthorizationError } from '@/lib/authorization';
import bcrypt from 'bcryptjs';
import { normalizePhoneOrNull } from '@/lib/utils/phone';
import { wouldCreateReportingCycle } from '@/lib/hr/manager-scope';
import {
  filterFieldsByPermission,
  rejectRestrictedFieldUpdates,
} from '@/lib/field-permission-filter';
import {
  resolveActorContext,
  assertPortalFeatureForRequest,
  assertPortalOwnResource,
} from '@/lib/employee-portal/portal-api-guard';
import { FeatureAccessDeniedError } from '@/lib/subscription/feature-access';

export const dynamic = 'force-dynamic';

/**
 * GET /api/employees/[id]
 * Get a single employee by ID
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const employeeId = params.id;
    const { searchParams } = new URL(request.url);
    const actor = await resolveActorContext(request);
    let businessId = getBusinessIdFromRequest(request);
    let userId = getUserIdFromRequest(request);
    if (actor) {
      businessId = actor.businessId;
      userId = actor.userId;
    }

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

    if (actor?.isPortal) {
      try {
        await assertPortalFeatureForRequest(request, actor.businessId, 'profile');
      } catch (error) {
        if (error instanceof FeatureAccessDeniedError) return error.toNextResponse();
        throw error;
      }
      const forbidden = assertPortalOwnResource(actor, employeeId);
      if (forbidden) return forbidden;
    }

    // AUTHORIZATION: Employee self-service - allow if user is accessing own profile OR has permission
    const { isEmployee } = await import('@/lib/access-boundary');
    const userIsEmployee = await isEmployee(userId);
    
    // If user is employee accessing own profile, allow without portal permission
    if (userIsEmployee && userId === employeeId) {
      // Self-service access allowed
    } else {
      // Portal user or accessing other employee - require permission
      try {
        await authorize(userId, 'employees', 'read', { businessId, resourceId: employeeId });
      } catch (error) {
        if (error instanceof AuthorizationError) {
          return error.toNextResponse();
        }
        throw error;
      }
    }

    const employee = await queryOne<Employee & {
      user_name: string;
      user_email?: string;
      user_phone: string;
      user_is_active: boolean;
      reporting_manager_name?: string;
      reporting_manager_code?: string;
    }>(
      `SELECT 
        e.*,
        u.name as user_name,
        u.email as user_email,
        u.phone as user_phone,
        u.is_active as user_is_active,
        u.role_id,
        rm.name as reporting_manager_name,
        rm.employee_code as reporting_manager_code
      FROM employees e
      INNER JOIN users u ON e.id = u.id
      LEFT JOIN employees rm ON e.reporting_manager_id = rm.id
      WHERE e.id = $1 AND e.business_id = $2`,
      [employeeId, businessId]
    );

    if (!employee) {
      return NextResponse.json(
        { error: 'Employee not found' },
        { status: 404 }
      );
    }

    // Fetch documents
    const documents = await queryRows(
      'SELECT * FROM employee_documents WHERE employee_id = $1 ORDER BY uploaded_at DESC',
      [employeeId]
    );

    const filteredEmployee = await filterFieldsByPermission(employee, userId, 'employees');

    return NextResponse.json({ employee: filteredEmployee, documents });
  } catch (error: any) {
    console.error('Error fetching employee:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/employees/[id]
 * Update an employee
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const employeeId = params.id;
    const { searchParams } = new URL(request.url);
    const businessId = getBusinessIdFromRequest(request);
    const body = await request.json();
    const { updated_by_user_id } = body; // REQUIRED for authorization

    if (!businessId) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    if (!updated_by_user_id) {
      return NextResponse.json(
        { error: 'updated_by_user_id is required for authorization' },
        { status: 400 }
      );
    }

    // Verify employee exists and belongs to business
    const existing = await queryOne(
      'SELECT id, business_id FROM employees WHERE id = $1 AND business_id = $2',
      [employeeId, businessId]
    );

    if (!existing) {
      return NextResponse.json(
        { error: 'Employee not found' },
        { status: 404 }
      );
    }

    // AUTHORIZATION: Check update permission (employees are part of HR module)
    try {
      await authorize(updated_by_user_id, 'employees', 'update', { businessId, resourceId: employeeId });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    const { rejected: restrictedFields } = await rejectRestrictedFieldUpdates(
      updated_by_user_id,
      'employees',
      body
    );
    if (restrictedFields.length > 0) {
      return NextResponse.json(
        {
          error: 'You do not have permission to update restricted employee fields',
          fields: restrictedFields,
        },
        { status: 403 }
      );
    }

    const {
      name,
      email,
      phone,
      password, // Optional password update
      employee_code,
      designation,
      department,
      joining_date,
      reporting_manager_id,
      employment_type,
      access_type,
      salary,
      photo_url,
      emergency_contact_name,
      emergency_contact_phone,
      bank_account_number,
      bank_ifsc,
      bank_name,
      pan_number,
      aadhaar_number,
      uan,
      esi_ip_number,
      pf_account_no,
      pf_applicable,
      esi_applicable,
      default_shift_id,
      branch_id,
      weekly_off_override,
      is_active,
      role_id,
    } = body;

    // Update user table if name, email, phone, or password provided
    if (name || email !== undefined || phone !== undefined || password) {
      const userUpdates: string[] = [];
      const userParams: any[] = [];
      let paramIndex = 1;

      if (name) {
        userUpdates.push(`name = $${paramIndex++}`);
        userParams.push(name);
      }
      if (email !== undefined) {
        userUpdates.push(`email = $${paramIndex++}`);
        userParams.push(email || null);
      }
      if (phone !== undefined) {
        const raw = typeof phone === 'string' ? phone : String(phone ?? '');
        const phoneNorm = normalizePhoneOrNull(raw);
        if (raw.trim() && !phoneNorm) {
          return NextResponse.json(
            { error: 'Invalid phone number' },
            { status: 400 }
          );
        }
        if (phoneNorm) {
          userUpdates.push(`phone = $${paramIndex++}`);
          userParams.push(phoneNorm);
        }
      }
      if (password) {
        const { validateEmployeePortalPassword } = await import('@/lib/employee-portal/password');
        const validation = validateEmployeePortalPassword(String(password));
        if (!validation.ok) {
          return NextResponse.json({ error: validation.error }, { status: 400 });
        }
        const passwordHash = await bcrypt.hash(String(password).trim(), 10);
        userUpdates.push(`password_hash = $${paramIndex++}`);
        userParams.push(passwordHash);
        userUpdates.push(`must_change_password = $${paramIndex++}`);
        userParams.push(true);
      }

      if (userUpdates.length > 0) {
        userParams.push(employeeId);
        await query(
          `UPDATE users SET ${userUpdates.join(', ')} WHERE id = $${paramIndex}`,
          userParams
        );
      }
    }

    // Update role if provided
    if (role_id !== undefined) {
      await query('UPDATE users SET role_id = $1 WHERE id = $2', [
        role_id || null,
        employeeId,
      ]);
    }

    // Update employee table
    const employeeUpdates: string[] = [];
    const employeeParams: any[] = [];
    let paramIndex = 1;

    if (employee_code) {
      // Check if code already exists for another employee
      const codeExists = await queryOne(
        'SELECT id FROM employees WHERE business_id = $1 AND employee_code = $2 AND id != $3',
        [businessId, employee_code, employeeId]
      );
      if (codeExists) {
        return NextResponse.json(
          { error: `Employee code "${employee_code}" already exists` },
          { status: 400 }
        );
      }
      employeeUpdates.push(`employee_code = $${paramIndex++}`);
      employeeParams.push(employee_code);
    }
    if (designation !== undefined) {
      employeeUpdates.push(`designation = $${paramIndex++}`);
      employeeParams.push(designation || null);
    }
    if (department !== undefined) {
      employeeUpdates.push(`department = $${paramIndex++}`);
      employeeParams.push(department || null);
    }
    if (default_shift_id !== undefined) {
      employeeUpdates.push(`default_shift_id = $${paramIndex++}`);
      employeeParams.push(default_shift_id || null);
    }
    if (branch_id !== undefined) {
      employeeUpdates.push(`branch_id = $${paramIndex++}`);
      employeeParams.push(branch_id || null);
    }
    if (weekly_off_override !== undefined) {
      employeeUpdates.push(`weekly_off_override = $${paramIndex++}::jsonb`);
      employeeParams.push(
        weekly_off_override ? JSON.stringify(weekly_off_override) : null,
      );
    }
    if (joining_date !== undefined) {
      employeeUpdates.push(`joining_date = $${paramIndex++}`);
      employeeParams.push(joining_date || null);
    }
    if (reporting_manager_id !== undefined) {
      const newManagerId = reporting_manager_id || null;
      if (newManagerId) {
        const cycle = await wouldCreateReportingCycle(businessId, employeeId, newManagerId);
        if (cycle) {
          return NextResponse.json(
            { error: 'Invalid reporting manager: would create a cycle in the org hierarchy' },
            { status: 400 }
          );
        }
      }
      employeeUpdates.push(`reporting_manager_id = $${paramIndex++}`);
      employeeParams.push(newManagerId);
    }
    if (employment_type) {
      employeeUpdates.push(`employment_type = $${paramIndex++}`);
      employeeParams.push(employment_type);
    }
    if (access_type) {
      employeeUpdates.push(`access_type = $${paramIndex++}`);
      employeeParams.push(access_type);
    }
    if (salary !== undefined) {
      employeeUpdates.push(`salary = $${paramIndex++}`);
      employeeParams.push(salary || null);
    }
    if (photo_url !== undefined) {
      employeeUpdates.push(`photo_url = $${paramIndex++}`);
      employeeParams.push(photo_url || null);
    }
    if (emergency_contact_name !== undefined) {
      employeeUpdates.push(`emergency_contact_name = $${paramIndex++}`);
      employeeParams.push(emergency_contact_name || null);
    }
    if (emergency_contact_phone !== undefined) {
      const raw = typeof emergency_contact_phone === 'string' ? emergency_contact_phone : String(emergency_contact_phone ?? '');
      const emNorm = normalizePhoneOrNull(raw);
      if (raw.trim() && !emNorm) {
        return NextResponse.json(
          { error: 'Invalid emergency contact phone' },
          { status: 400 }
        );
      }
      employeeUpdates.push(`emergency_contact_phone = $${paramIndex++}`);
      employeeParams.push(emNorm);
    }
    if (bank_account_number !== undefined) {
      employeeUpdates.push(`bank_account_number = $${paramIndex++}`);
      employeeParams.push(bank_account_number || null);
    }
    if (bank_ifsc !== undefined) {
      employeeUpdates.push(`bank_ifsc = $${paramIndex++}`);
      employeeParams.push(bank_ifsc || null);
    }
    if (bank_name !== undefined) {
      employeeUpdates.push(`bank_name = $${paramIndex++}`);
      employeeParams.push(bank_name || null);
    }
    if (pan_number !== undefined) {
      employeeUpdates.push(`pan_number = $${paramIndex++}`);
      employeeParams.push(pan_number || null);
    }
    if (aadhaar_number !== undefined) {
      employeeUpdates.push(`aadhaar_number = $${paramIndex++}`);
      employeeParams.push(aadhaar_number || null);
    }
    if (uan !== undefined) {
      employeeUpdates.push(`uan = $${paramIndex++}`);
      employeeParams.push(uan ? String(uan).trim() : null);
    }
    if (esi_ip_number !== undefined) {
      employeeUpdates.push(`esi_ip_number = $${paramIndex++}`);
      employeeParams.push(esi_ip_number ? String(esi_ip_number).trim() : null);
    }
    if (pf_account_no !== undefined) {
      employeeUpdates.push(`pf_account_no = $${paramIndex++}`);
      employeeParams.push(pf_account_no ? String(pf_account_no).trim() : null);
    }
    if (pf_applicable !== undefined) {
      employeeUpdates.push(`pf_applicable = $${paramIndex++}`);
      employeeParams.push(!!pf_applicable);
    }
    if (esi_applicable !== undefined) {
      employeeUpdates.push(`esi_applicable = $${paramIndex++}`);
      employeeParams.push(!!esi_applicable);
    }
    if (is_active !== undefined) {
      employeeUpdates.push(`is_active = $${paramIndex++}`);
      employeeParams.push(is_active);
    }

    if (employeeUpdates.length > 0) {
      employeeParams.push(employeeId);
      await query(
        `UPDATE employees SET ${employeeUpdates.join(', ')} WHERE id = $${paramIndex}`,
        employeeParams
      );
    }

    // Fetch updated employee
    const updatedEmployee = await queryOne<Employee & {
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
      [employeeId]
    );

    const filteredEmployee = updatedEmployee
      ? await filterFieldsByPermission(updatedEmployee, updated_by_user_id, 'employees')
      : null;

    return NextResponse.json({ employee: filteredEmployee });
  } catch (error: any) {
    console.error('Error updating employee:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/employees/[id]
 * Soft delete an employee (set is_active = false)
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const employeeId = params.id;
    const { searchParams } = new URL(request.url);
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request); // REQUIRED for authorization

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

    // Verify employee exists and belongs to business
    const existing = await queryOne(
      'SELECT id, business_id FROM employees WHERE id = $1 AND business_id = $2',
      [employeeId, businessId]
    );

    if (!existing) {
      return NextResponse.json(
        { error: 'Employee not found' },
        { status: 404 }
      );
    }

    // AUTHORIZATION: Check delete permission (employees are part of HR module)
    try {
      await authorize(userId, 'employees', 'delete', { businessId, resourceId: employeeId });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    // Soft delete: set is_active = false for both employee and user
    await query(
      'UPDATE employees SET is_active = false WHERE id = $1',
      [employeeId]
    );
    await query('UPDATE users SET is_active = false WHERE id = $1', [
      employeeId,
    ]);

    return NextResponse.json({ message: 'Employee deactivated successfully' });
  } catch (error: any) {
    console.error('Error deleting employee:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

