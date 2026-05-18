import { NextRequest, NextResponse } from 'next/server';
import { queryOne, query } from '@/lib/db';
import { EmployeeAttendance } from '@/types/database';
import { authorize, AuthorizationError } from '@/lib/authorization';

/**
 * POST /api/employees/attendance/check-in
 * Check-in for attendance (face recognition, mobile app, or OTP)
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      employee_id,
      session_token, // For OTP-based login
      method = 'manual', // 'face_recognition', 'mobile_app', 'manual', 'kiosk', 'otp'
      location_lat,
      location_lng,
      recognition_confidence, // For face recognition (0-1)
      device_info,
      ip_address,
    } = body;

    if (!employee_id && !session_token) {
      return NextResponse.json(
        { error: 'Either employee_id or session_token is required' },
        { status: 400 }
      );
    }

    let finalEmployeeId = employee_id;

    // If session_token provided, verify and get employee_id
    if (session_token) {
      const session = await queryOne(
        `SELECT employee_id FROM attendance_sessions
         WHERE session_token = $1 AND expires_at > CURRENT_TIMESTAMP`,
        [session_token]
      );

      if (!session) {
        return NextResponse.json(
          { error: 'Invalid or expired session' },
          { status: 401 }
        );
      }

      finalEmployeeId = session.employee_id;
    }

    if (!finalEmployeeId) {
      return NextResponse.json(
        { error: 'Employee ID is required' },
        { status: 400 }
      );
    }

    // Get employee business_id for authorization
    const employee = await queryOne<{ business_id: string }>(
      'SELECT business_id FROM employees WHERE id = $1',
      [finalEmployeeId]
    );

    if (!employee) {
      return NextResponse.json(
        { error: 'Employee not found' },
        { status: 404 }
      );
    }

    // AUTHORIZATION: Attendance check-in is self-service
    // If called via session_token (attendance login), allow without portal permission
    // If called directly with employee_id, check if it's self-service or requires permission
    if (!session_token) {
      // Direct call - check if user is employee doing self-service OR has permission
      const { isEmployee } = await import('@/lib/access-boundary');
      const userIsEmployee = await isEmployee(finalEmployeeId);
      
      if (!userIsEmployee) {
        // Not an employee - require portal permission
        try {
          await authorize(finalEmployeeId, 'attendance', 'create', { businessId: employee.business_id });
        } catch (error) {
          if (error instanceof AuthorizationError) {
            return error.toNextResponse();
          }
          throw error;
        }
      }
      // Employee self-service - allow without portal permission
    }
    // Session token call - already verified, allow

    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

    // Check if attendance already exists for today
    let attendance = await queryOne<EmployeeAttendance>(
      'SELECT * FROM employee_attendance WHERE employee_id = $1 AND date = $2',
      [finalEmployeeId, today]
    );

    if (attendance && attendance.check_in_time) {
      return NextResponse.json(
        { error: 'Already checked in today' },
        { status: 400 }
      );
    }

    const checkInTime = new Date();

    if (attendance) {
      // Update existing attendance record
      await query(
        `UPDATE employee_attendance
         SET check_in_time = $1, check_in_method = $2,
             check_in_location_lat = $3, check_in_location_lng = $4,
             status = 'present', updated_at = CURRENT_TIMESTAMP
         WHERE id = $5`,
        [
          checkInTime,
          method,
          location_lat || null,
          location_lng || null,
          attendance.id,
        ]
      );

      attendance = await queryOne<EmployeeAttendance>(
        'SELECT * FROM employee_attendance WHERE id = $1',
        [attendance.id]
      );
    } else {
      // Create new attendance record
      attendance = await queryOne<EmployeeAttendance>(
        `INSERT INTO employee_attendance (
          employee_id, date, check_in_time, check_in_method,
          check_in_location_lat, check_in_location_lng, status
        )
        VALUES ($1, $2, $3, $4, $5, $6, 'present')
        RETURNING *`,
        [
          finalEmployeeId,
          today,
          checkInTime,
          method,
          location_lat || null,
          location_lng || null,
        ]
      );
    }

    if (!attendance) {
      return NextResponse.json(
        { error: 'Failed to create or update attendance' },
        { status: 500 }
      );
    }

    // Create attendance log
    await query(
      `INSERT INTO attendance_logs (
        employee_id, attendance_id, log_type, log_time,
        location_lat, location_lng, device_info, ip_address,
        recognition_confidence, method
      )
      VALUES ($1, $2, 'check_in', $3, $4, $5, $6, $7, $8, $9)`,
      [
        finalEmployeeId,
        attendance.id,
        checkInTime,
        location_lat || null,
        location_lng || null,
        device_info || null,
        ip_address || null,
        recognition_confidence || null,
        method,
      ]
    );

    return NextResponse.json({
      success: true,
      attendance,
      message: 'Checked in successfully',
    });
  } catch (error: any) {
    console.error('Error checking in:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

