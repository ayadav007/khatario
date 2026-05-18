import { NextRequest, NextResponse } from 'next/server';
import { queryRows } from '@/lib/db';
import { requirePlatformRequest } from '@/lib/platform-request-auth';

/**
 * GET /api/admin/email-logs?limit=50&offset=0
 */
export async function GET(request: NextRequest) {
  const auth = await requirePlatformRequest(request, 'admin');
  if (!auth.ok) return auth.response;

  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 200);
    const offset = parseInt(searchParams.get('offset') || '0', 10);

    const rows = await queryRows<{
      id: string;
      recipient_email: string;
      subject: string;
      template_key: string | null;
      business_id: string | null;
      status: string;
      error_message: string | null;
      created_at: string;
    }>(
      `SELECT id, recipient_email, subject, template_key, business_id, status, error_message, created_at
       FROM platform_email_logs
       ORDER BY created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset],
    );

    return NextResponse.json({ logs: rows, limit, offset });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('platform_email_logs')) {
      return NextResponse.json({
        logs: [],
        limit: 50,
        offset: 0,
        warning: 'Run migration 233_platform_email_system.sql to enable email logs.',
      });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
