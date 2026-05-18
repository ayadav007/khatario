import { NextRequest, NextResponse } from 'next/server';
import { queryOne, query } from '@/lib/db';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';

const OTP_SEND_LIMIT = 10;
const OTP_SEND_WINDOW_MS = 15 * 60 * 1000;

/**
 * POST /api/attendance/send-otp
 * Send OTP to employee phone for attendance login
 */
export async function POST(request: NextRequest) {
  try {
    const ip = getClientIp(request);
    const rl = checkRateLimit(`attendance-otp:${ip}`, OTP_SEND_LIMIT, OTP_SEND_WINDOW_MS);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Too many requests. Please try again later.', retryAfterMs: rl.retryAfterMs },
        { status: 429 }
      );
    }

    const body = await request.json();
    const { phone, business_id } = body;

    if (!phone || !business_id) {
      return NextResponse.json(
        { error: 'Phone number and business_id are required' },
        { status: 400 }
      );
    }

    // Find employee by phone number
    const employee = await queryOne(
      `SELECT e.id, e.employee_code, e.access_type, u.name, u.phone
       FROM employees e
       INNER JOIN users u ON e.id = u.id
       WHERE u.phone = $1 AND e.business_id = $2 AND e.is_active = true AND u.is_active = true`,
      [phone, business_id]
    );

    if (!employee) {
      // Don't reveal if employee exists or not for security
      return NextResponse.json(
        { message: 'If an employee exists with this phone number, an OTP will be sent' },
        { status: 200 }
      );
    }

    // Check if employee has attendance-only access
    if (employee.access_type !== 'attendance_only') {
      return NextResponse.json(
        { error: 'This phone number is registered for full access. Please use the regular login.' },
        { status: 400 }
      );
    }

    // Generate 6-digit OTP
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + 10); // OTP valid for 10 minutes

    // Delete any existing unused OTPs for this employee
    await query(
      'DELETE FROM attendance_otps WHERE employee_id = $1 AND is_used = false',
      [employee.id]
    );

    // Create new OTP
    await query(
      `INSERT INTO attendance_otps (employee_id, phone, otp_code, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [employee.id, phone, otpCode, expiresAt]
    );

    // TODO: Send OTP via SMS/WhatsApp
    // For now, we'll return it in development (remove in production)
    const isDevelopment = process.env.NODE_ENV === 'development';
    
    if (isDevelopment) {
      console.log(`[DEV] OTP for ${phone}: ${otpCode}`);
    }

    // In production, integrate with SMS/WhatsApp service
    // Example: await sendSMS(phone, `Your attendance login OTP is ${otpCode}. Valid for 10 minutes.`);

    return NextResponse.json({
      message: 'OTP sent successfully',
      // Only return OTP in development
      ...(isDevelopment && { otp: otpCode }),
    });
  } catch (error: any) {
    console.error('Error sending OTP:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

