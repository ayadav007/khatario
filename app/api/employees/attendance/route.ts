import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, getBusinessIdFromRequest, resolveCreatedByUserId } from '@/lib/auth-helpers';
import { queryRows, queryOne, query } from '@/lib/db';
import { EmployeeAttendance } from '@/types/database';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { limitExceededResponse } from '@/lib/subscription/limit-response';

/**
 * GET /api/employees/attendance
 * List attendance records
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request); // REQUIRED for authorization
    const employeeId = searchParams.get('employee_id');
    const startDate = searchParams.get('start_date');
    const endDate = searchParams.get('end_date');
    const status = searchParams.get('status');

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

    // AUTHORIZATION: Check read permission (attendance is part of HR module)
    try {
      await authorize(userId, 'attendance', 'read', { businessId });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    let sql = `
      SELECT 
        a.*,
        e.employee_code,
        e.designation,
        u.name as employee_name,
        s.shift_name,
        s.start_time as shift_start_time,
        s.end_time as shift_end_time
      FROM employee_attendance a
      INNER JOIN employees e ON a.employee_id = e.id
      INNER JOIN users u ON e.id = u.id
      LEFT JOIN shifts s ON a.shift_id = s.id
      WHERE e.business_id = $1
    `;
    const params: any[] = [businessId];
    let paramIndex = 2;

    if (employeeId) {
      sql += ` AND a.employee_id = $${paramIndex}`;
      params.push(employeeId);
      paramIndex++;
    }

    if (startDate) {
      sql += ` AND a.date >= $${paramIndex}`;
      params.push(startDate);
      paramIndex++;
    }

    if (endDate) {
      sql += ` AND a.date <= $${paramIndex}`;
      params.push(endDate);
      paramIndex++;
    }

    if (status) {
      sql += ` AND a.status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }

    sql += ` ORDER BY a.date DESC, a.check_in_time DESC LIMIT 100`;

    const attendance = await queryRows<EmployeeAttendance & {
      employee_code: string;
      designation?: string;
      employee_name: string;
      shift_name?: string;
      shift_start_time?: string;
      shift_end_time?: string;
    }>(sql, params);

    return NextResponse.json({ attendance });
  } catch (error: any) {
    console.error('Error fetching attendance:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/employees/attendance
 * Mark attendance (manual entry by manager)
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      business_id,
      employee_id,
      date,
      shift_id,
      status = 'present',
      check_in_time,
      check_out_time,
      break_duration = 0,
      notes,
    } = body;
    const createdByUserId = resolveCreatedByUserId(request, body);

    if (!business_id || !employee_id || !date) {
      return NextResponse.json(
        { error: 'business_id, employee_id, and date are required' },
        { status: 400 }
      );
    }

    if (!createdByUserId) {
      return NextResponse.json(
        { error: 'created_by_user_id is required for authorization' },
        { status: 400 }
      );
    }

    // AUTHORIZATION: Attendance is self-service - allow if user is employee OR has permission
    const { isEmployee } = await import('@/lib/access-boundary');
    const userIsEmployee = await isEmployee(createdByUserId);
    
    // If user is employee managing own attendance, allow without portal permission
    if (userIsEmployee && createdByUserId === employee_id) {
      // Self-service access allowed
    } else {
      // Portal user or managing other employee - require permission
      try {
        await authorize(createdByUserId, 'attendance', 'create', { businessId: business_id });
      } catch (error) {
        if (error instanceof AuthorizationError) {
          return error.toNextResponse();
        }
        throw error;
      }
    }

    // Verify employee belongs to business
    const employee = await queryOne(
      'SELECT id FROM employees WHERE id = $1 AND business_id = $2',
      [employee_id, business_id]
    );

    if (!employee) {
      return NextResponse.json(
        { error: 'Employee not found' },
        { status: 404 }
      );
    }

    const attendanceLimit = await limitExceededResponse(business_id, 'attendance');
    if (attendanceLimit) return attendanceLimit;

    // Check if attendance already exists for this date
    const existing = await queryOne(
      'SELECT id FROM employee_attendance WHERE employee_id = $1 AND date = $2',
      [employee_id, date]
    );

    if (existing) {
      return NextResponse.json(
        { error: 'Attendance already marked for this date' },
        { status: 400 }
      );
    }

    // Create attendance record
    const attendance = await queryOne<EmployeeAttendance>(
      `INSERT INTO employee_attendance (
        employee_id, date, shift_id, status, check_in_time, check_out_time,
        break_duration, notes, check_in_method, check_out_method
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *`,
      [
        employee_id,
        date,
        shift_id || null,
        status,
        check_in_time || null,
        check_out_time || null,
        break_duration,
        notes || null,
        'manual',
        check_out_time ? 'manual' : null,
      ]
    );

    if (!attendance) {
      return NextResponse.json(
        { error: 'Failed to create attendance record' },
        { status: 500 }
      );
    }

    // Create attendance log for check-in if provided
    if (check_in_time) {
      await query(
        `INSERT INTO attendance_logs (
          employee_id, attendance_id, log_type, log_time, method
        )
        VALUES ($1, $2, 'check_in', $3, 'manual')`,
        [employee_id, attendance.id, check_in_time]
      );
    }

    // Create attendance log for check-out if provided
    if (check_out_time) {
      await query(
        `INSERT INTO attendance_logs (
          employee_id, attendance_id, log_type, log_time, method
        )
        VALUES ($1, $2, 'check_out', $3, 'manual')`,
        [employee_id, attendance.id, check_out_time]
      );
    }

    return NextResponse.json({ attendance }, { status: 201 });
  } catch (error: any) {
    console.error('Error creating attendance:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

