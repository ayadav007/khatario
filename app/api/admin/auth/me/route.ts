import { NextRequest, NextResponse } from 'next/server';
import { requirePlatformRequest } from '@/lib/platform-request-auth';

/**
 * GET /api/admin/auth/me
 * Get current platform admin details
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requirePlatformRequest(request, 'viewer');
    if (!auth.ok) return auth.response;

    return NextResponse.json({ admin: auth.admin });
  } catch (error: any) {
    console.error('Error fetching platform admin:', error);
    return NextResponse.json(
      { error: 'Failed to fetch admin details', details: error.message },
      { status: 500 }
    );
  }
}

