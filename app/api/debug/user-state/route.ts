import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, requirePortalSession } from '@/lib/auth-helpers';
import { queryOne, queryRows } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const gate = await requirePortalSession(request);
    if (gate) return gate;

    const { searchParams } = new URL(request.url);
    const userId = getUserIdFromRequest(request);
    const phone = searchParams.get('phone');

    if (!userId && !phone) {
      return NextResponse.json(
        { error: 'user_id or phone is required' },
        { status: 400 }
      );
    }

    let user: any = null;
    if (userId) {
      user = await queryOne(
        'SELECT id, name, phone, business_id, role_id, is_primary_admin FROM users WHERE id = $1',
        [userId]
      );
    } else if (phone) {
      user = await queryOne(
        'SELECT id, name, phone, business_id, role_id, is_primary_admin FROM users WHERE phone = $1',
        [phone]
      );
    }

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Get role info
    let role: any = null;
    if (user.role_id) {
      role = await queryOne(
        'SELECT id, role_name, role_key, business_id FROM user_roles WHERE id = $1',
        [user.role_id]
      );
    }

    // If is_primary_admin but no role_id, find primary_admin role
    let primaryAdminRole: any = null;
    if (user.is_primary_admin && !user.role_id && user.business_id) {
      primaryAdminRole = await queryOne(
        'SELECT id, role_name, role_key FROM user_roles WHERE business_id = $1 AND role_key = $2',
        [user.business_id, 'primary_admin']
      );
    }

    // Check dashboard permissions
    let dashboardPermission: any = null;
    if (user.role_id) {
      dashboardPermission = await queryOne(
        'SELECT can_view FROM role_permissions WHERE role_id = $1 AND module_key = $2',
        [user.role_id, 'dashboard']
      );
    } else if (primaryAdminRole?.id) {
      dashboardPermission = await queryOne(
        'SELECT can_view FROM role_permissions WHERE role_id = $1 AND module_key = $2',
        [primaryAdminRole.id, 'dashboard']
      );
    }

    return NextResponse.json({
      user,
      role,
      primaryAdminRole,
      dashboardPermission,
      hasDashboardRead: dashboardPermission?.can_view === true,
    });
  } catch (error: any) {
    console.error('Debug user state error:', error);
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}
