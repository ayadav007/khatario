import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, requirePortalSession, requireTenantBusinessId } from '@/lib/auth-helpers';
import { loadHrNavSectionForUser } from '@/lib/hr/hr-nav-for-user';

export const dynamic = 'force-dynamic';

/**
 * GET /api/navigation/hr
 * The HR menu section for the signed-in user: the items their plan includes and their role can open.
 * Returns: { section: { title, items: [{ href, label }] } | null }
 */
export async function GET(request: NextRequest) {
  try {
    const gate = await requirePortalSession(request);
    if (gate) return gate;

    const userId = getUserIdFromRequest(request);
    if (!userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    const tenant = requireTenantBusinessId(request);
    if (!tenant.ok) return tenant.response;

    const section = await loadHrNavSectionForUser(tenant.businessId, userId);
    return NextResponse.json({
      section: section && {
        title: section.title,
        items: section.items.map((item) => ({ href: item.href, label: item.label })),
      },
    });
  } catch (error: unknown) {
    console.error('[HR navigation] Failed to build HR menu:', error);
    return NextResponse.json({ error: 'Failed to load HR menu' }, { status: 500 });
  }
}
