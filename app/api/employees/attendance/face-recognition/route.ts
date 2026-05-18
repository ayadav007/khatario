import { NextRequest, NextResponse } from 'next/server';
import { queryRows, queryOne, query } from '@/lib/db';
import { parseFaceEncoding, matchFace, serializeFaceEncoding } from '@/lib/face-recognition';

/**
 * POST /api/employees/attendance/face-recognition
 * Check-in/out using face recognition
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      business_id,
      face_encoding, // JSON string of 128-dim Float32Array
      action, // 'check_in' or 'check_out'
      location_lat,
      location_lng,
      device_info,
      ip_address,
    } = body;

    if (!business_id || !face_encoding || !action) {
      return NextResponse.json(
        { error: 'business_id, face_encoding, and action are required' },
        { status: 400 }
      );
    }

    if (action !== 'check_in' && action !== 'check_out') {
      return NextResponse.json(
        { error: 'action must be "check_in" or "check_out"' },
        { status: 400 }
      );
    }

    // Parse face encoding
    let descriptor: Float32Array;
    try {
      const encodingArray = JSON.parse(face_encoding);
      descriptor = new Float32Array(encodingArray);
      if (descriptor.length !== 128) {
        throw new Error('Face encoding must be 128-dimensional');
      }
    } catch (error: any) {
      return NextResponse.json(
        { error: `Invalid face encoding format: ${error.message}` },
        { status: 400 }
      );
    }

    // Fetch all active employee face encodings for this business
    const employeeFaces = await queryRows<{
      employee_id: string;
      employee_code: string;
      face_encoding: string;
      name: string;
    }>(
      `SELECT 
        e.id as employee_id,
        e.employee_code,
        efd.face_encoding,
        u.name
      FROM employee_face_data efd
      INNER JOIN employees e ON efd.employee_id = e.id
      INNER JOIN users u ON e.id = u.id
      WHERE e.business_id = $1 AND efd.is_active = true
      AND e.is_active = true AND u.is_active = true`,
      [business_id]
    );

    if (employeeFaces.length === 0) {
      return NextResponse.json(
        { error: 'No face data enrolled for employees in this business' },
        { status: 404 }
      );
    }

    // Prepare encodings for matching
    const faceEncodings = employeeFaces.map((ef) => ({
      employeeId: ef.employee_id,
      employeeCode: ef.employee_code,
      employeeName: ef.name,
      encoding: parseFaceEncoding(ef.face_encoding),
    }));

    // Match face
    const match = matchFace(descriptor, faceEncodings, 0.6); // 60% similarity threshold

    if (!match) {
      return NextResponse.json(
        { error: 'Face not recognized. Please try again or use manual entry.' },
        { status: 404 }
      );
    }

    // Perform check-in or check-out
    const today = new Date().toISOString().split('T')[0];

    if (action === 'check_in') {
      // Check if already checked in
      const existing = await queryOne(
        'SELECT id, check_in_time FROM employee_attendance WHERE employee_id = $1 AND date = $2',
        [match.employeeId, today]
      );

      if (existing && existing.check_in_time) {
        return NextResponse.json(
          { error: 'Already checked in today' },
          { status: 400 }
        );
      }

      const checkInTime = new Date();

      if (existing) {
        // Update existing record
        await query(
          `UPDATE employee_attendance
           SET check_in_time = $1, check_in_method = 'face_recognition',
               check_in_location_lat = $2, check_in_location_lng = $3,
               status = 'present', updated_at = CURRENT_TIMESTAMP
           WHERE id = $4`,
          [checkInTime, location_lat || null, location_lng || null, existing.id]
        );
      } else {
        // Create new record
        await query(
          `INSERT INTO employee_attendance (
            employee_id, date, check_in_time, check_in_method,
            check_in_location_lat, check_in_location_lng, status
          )
          VALUES ($1, $2, $3, 'face_recognition', $4, $5, 'present')`,
          [match.employeeId, today, checkInTime, location_lat || null, location_lng || null]
        );
      }

      // Create log
      const attendance = await queryOne(
        'SELECT id FROM employee_attendance WHERE employee_id = $1 AND date = $2',
        [match.employeeId, today]
      );

      await query(
        `INSERT INTO attendance_logs (
          employee_id, attendance_id, log_type, log_time,
          location_lat, location_lng, device_info, ip_address,
          recognition_confidence, method
        )
        VALUES ($1, $2, 'check_in', $3, $4, $5, $6, $7, $8, 'face_recognition')`,
        [
          match.employeeId,
          attendance.id,
          checkInTime,
          location_lat || null,
          location_lng || null,
          device_info || null,
          ip_address || null,
          match.confidence,
        ]
      );

      return NextResponse.json({
        success: true,
        action: 'check_in',
        employee: {
          id: match.employeeId,
          code: match.employeeCode,
          name: match.employeeName,
        },
        confidence: match.confidence,
        message: `Checked in: ${match.employeeName} (${match.employeeCode})`,
      });
    } else {
      // Check-out
      const attendance = await queryOne(
        'SELECT id, check_in_time, check_out_time FROM employee_attendance WHERE employee_id = $1 AND date = $2',
        [match.employeeId, today]
      );

      if (!attendance || !attendance.check_in_time) {
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

      await query(
        `UPDATE employee_attendance
         SET check_out_time = $1, check_out_method = 'face_recognition',
             check_out_location_lat = $2, check_out_location_lng = $3,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $4`,
        [checkOutTime, location_lat || null, location_lng || null, attendance.id]
      );

      // Create log
      await query(
        `INSERT INTO attendance_logs (
          employee_id, attendance_id, log_type, log_time,
          location_lat, location_lng, device_info, ip_address,
          recognition_confidence, method
        )
        VALUES ($1, $2, 'check_out', $3, $4, $5, $6, $7, $8, 'face_recognition')`,
        [
          match.employeeId,
          attendance.id,
          checkOutTime,
          location_lat || null,
          location_lng || null,
          device_info || null,
          ip_address || null,
          match.confidence,
        ]
      );

      return NextResponse.json({
        success: true,
        action: 'check_out',
        employee: {
          id: match.employeeId,
          code: match.employeeCode,
          name: match.employeeName,
        },
        confidence: match.confidence,
        message: `Checked out: ${match.employeeName} (${match.employeeCode})`,
      });
    }
  } catch (error: any) {
    console.error('Error in face recognition attendance:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

