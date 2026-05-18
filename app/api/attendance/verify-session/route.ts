import { NextRequest, NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';

/**
 * POST /api/attendance/verify-session
 * Verify attendance session token
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { session_token } = body;

    if (!session_token) {
      return NextResponse.json(
        { error: 'Session token is required' },
        { status: 400 }
      );
    }

    // Find valid session
    const session = await queryOne(
      `SELECT s.*, e.employee_code, e.access_type, u.name, u.phone
       FROM attendance_sessions s
       INNER JOIN employees e ON s.employee_id = e.id
       INNER JOIN users u ON e.id = u.id
       WHERE s.session_token = $1 AND s.expires_at > CURRENT_TIMESTAMP
       AND e.is_active = true AND u.is_active = true`,
      [session_token]
    );

    if (!session) {
      return NextResponse.json(
        { error: 'Invalid or expired session' },
        { status: 401 }
      );
    }

    return NextResponse.json({
      valid: true,
      employee: {
        id: session.employee_id,
        name: session.name,
        employee_code: session.employee_code,
        access_type: session.access_type,
      },
      expires_at: session.expires_at,
    });
  } catch (error: any) {
    console.error('Error verifying session:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

