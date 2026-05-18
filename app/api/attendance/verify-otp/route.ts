import { NextRequest, NextResponse } from 'next/server';
import { queryOne, query } from '@/lib/db';
import crypto from 'crypto';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';

const VERIFY_LIMIT = 20;
const VERIFY_WINDOW_MS = 15 * 60 * 1000;

/**
 * POST /api/attendance/verify-otp
 * Verify OTP and create attendance session
 */
export async function POST(request: NextRequest) {
  try {
    const ip = getClientIp(request);
    const rl = checkRateLimit(`attendance-verify:${ip}`, VERIFY_LIMIT, VERIFY_WINDOW_MS);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Too many attempts. Please try again later.', retryAfterMs: rl.retryAfterMs },
        { status: 429 }
      );
    }

    const body = await request.json();
    const { phone, otp_code, business_id } = body;

    if (!phone || !otp_code || !business_id) {
      return NextResponse.json(
        { error: 'Phone number, OTP code, and business_id are required' },
        { status: 400 }
      );
    }

    // Find employee
    const employee = await queryOne(
      `SELECT e.id, e.employee_code, e.access_type, u.name, u.phone
       FROM employees e
       INNER JOIN users u ON e.id = u.id
       WHERE u.phone = $1 AND e.business_id = $2 AND e.is_active = true AND u.is_active = true`,
      [phone, business_id]
    );

    if (!employee) {
      return NextResponse.json(
        { error: 'Invalid phone number or employee not found' },
        { status: 404 }
      );
    }

    // Find valid OTP
    const otp = await queryOne(
      `SELECT * FROM attendance_otps
       WHERE employee_id = $1 AND phone = $2 AND otp_code = $3
       AND expires_at > CURRENT_TIMESTAMP AND is_used = false
       ORDER BY created_at DESC
       LIMIT 1`,
      [employee.id, phone, otp_code]
    );

    if (!otp) {
      return NextResponse.json(
        { error: 'Invalid or expired OTP' },
        { status: 400 }
      );
    }

    // Mark OTP as used
    await query(
      'UPDATE attendance_otps SET is_used = true WHERE id = $1',
      [otp.id]
    );

    // Generate session token
    const sessionToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 1); // Session valid for 1 hour

    // Create session
    await query(
      `INSERT INTO attendance_sessions (employee_id, session_token, expires_at)
       VALUES ($1, $2, $3)`,
      [employee.id, sessionToken, expiresAt]
    );

    // Clean up expired sessions
    await query(
      'DELETE FROM attendance_sessions WHERE expires_at < CURRENT_TIMESTAMP',
      []
    );

    return NextResponse.json({
      success: true,
      session_token: sessionToken,
      employee: {
        id: employee.id,
        name: employee.name,
        employee_code: employee.employee_code,
        access_type: employee.access_type,
      },
      expires_at: expiresAt.toISOString(),
    });
  } catch (error: any) {
    console.error('Error verifying OTP:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

