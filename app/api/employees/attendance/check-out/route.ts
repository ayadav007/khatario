import { NextRequest, NextResponse } from 'next/server';
import { queryOne, query } from '@/lib/db';
import { EmployeeAttendance } from '@/types/database';
import { authorize, AuthorizationError } from '@/lib/authorization';

/**
 * POST /api/employees/attendance/check-out
 * Check-out for attendance
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

    // AUTHORIZATION: Check update permission (attendance check-out - self-service allowed)
    try {
      await authorize(finalEmployeeId, 'attendance', 'update', { businessId: employee.business_id });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

    // Find today's attendance
    const attendance = await queryOne<EmployeeAttendance>(
      'SELECT * FROM employee_attendance WHERE employee_id = $1 AND date = $2',
      [finalEmployeeId, today]
    );

    if (!attendance) {
      return NextResponse.json(
        { error: 'No check-in found for today. Please check in first.' },
        { status: 400 }
      );
    }

    if (attendance.check_out_time) {
      return NextResponse.json(
        { error: 'Already checked out today' },
        { status: 400 }
      );
    }

    const checkOutTime = new Date();

    // Update attendance record
    await query(
      `UPDATE employee_attendance
       SET check_out_time = $1, check_out_method = $2,
           check_out_location_lat = $3, check_out_location_lng = $4,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $5`,
      [
        checkOutTime,
        method,
        location_lat || null,
        location_lng || null,
        attendance.id,
      ]
    );

    // Fetch updated attendance (with calculated total_hours)
    const updatedAttendance = await queryOne<EmployeeAttendance>(
      'SELECT * FROM employee_attendance WHERE id = $1',
      [attendance.id]
    );

    // Create attendance log
    await query(
      `INSERT INTO attendance_logs (
        employee_id, attendance_id, log_type, log_time,
        location_lat, location_lng, device_info, ip_address,
        recognition_confidence, method
      )
      VALUES ($1, $2, 'check_out', $3, $4, $5, $6, $7, $8, $9)`,
      [
        finalEmployeeId,
        attendance.id,
        checkOutTime,
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
      attendance: updatedAttendance,
      message: 'Checked out successfully',
    });
  } catch (error: any) {
    console.error('Error checking out:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

