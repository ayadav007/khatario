import { NextRequest, NextResponse } from 'next/server';
import { listPlatformAdmins, createPlatformAdmin } from '@/lib/platform-auth';
import { requirePlatformRequest } from '@/lib/platform-request-auth';

/**
 * GET /api/admin/platform-users
 * List all platform admins (super_admin only)
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requirePlatformRequest(request, 'super_admin', 'can_manage_admins');
    if (!auth.ok) return auth.response;

    const admins = await listPlatformAdmins(auth.admin.id);

    return NextResponse.json({ admins });
  } catch (error: any) {
    console.error('Error fetching platform admins:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch platform admins' },
      { status: 403 }
    );
  }
}

/**
 * POST /api/admin/platform-users
 * Create a new platform admin (super_admin only)
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requirePlatformRequest(request, 'super_admin', 'can_manage_admins');
    if (!auth.ok) return auth.response;

    const body = await request.json();
    const { name, email, password, role } = body;

    if (!name || !email || !password || !role) {
      return NextResponse.json(
        { error: 'Name, email, password, and role are required' },
        { status: 400 }
      );
    }

    if (!['admin', 'support', 'viewer'].includes(role)) {
      return NextResponse.json(
        { error: 'Invalid role. Must be: admin, support, or viewer' },
        { status: 400 }
      );
    }

    const admin = await createPlatformAdmin(auth.admin.id, {
      name,
      email,
      password,
      role,
    });

    return NextResponse.json({ admin }, { status: 201 });
  } catch (error: any) {
    console.error('Error creating platform admin:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to create platform admin' },
      { status: error.message.includes('permission') ? 403 : 500 }
    );
  }
}

