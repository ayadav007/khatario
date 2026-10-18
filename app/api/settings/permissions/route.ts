import { NextRequest, NextResponse } from 'next/server';
import { loadUserModulePermissions } from '@/lib/user-module-permissions';
import { getUserIdFromRequest, requirePortalSession } from '@/lib/auth-helpers';

export const dynamic = 'force-dynamic';

/**
 * GET /api/settings/permissions
 * Get permissions for a user in the format expected by the frontend
 * Returns: { permissions: { module_key: { can_view, can_add, can_modify, can_delete, can_share } } }
 */
export async function GET(request: NextRequest) {
  try {
    const gate = await requirePortalSession(request);
    if (gate) return gate;

    const userId = getUserIdFromRequest(request);

    if (!userId) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      );
    }

    const loaded = await loadUserModulePermissions(userId);
    if (!loaded) {
      return NextResponse.json({ permissions: {} });
    }
    const { permissions, isPrimaryAdmin } = loaded;

    return NextResponse.json({ permissions, isPrimaryAdmin });
  } catch (error: any) {
    console.error('Error fetching permissions:', error);
    return NextResponse.json(
      { error: 'Failed to fetch permissions', details: error.message },
      { status: 500 }
    );
  }
}
