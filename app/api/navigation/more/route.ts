import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, requirePortalSession, requireTenantBusinessId } from '@/lib/auth-helpers';
import { loadMoreMenuForUser } from '@/lib/navigation/more-menu-for-user';

export const dynamic = 'force-dynamic';

/**
 * GET /api/navigation/more
 * The More menu for the signed-in user, built from `lib/more-navigation.ts` with their plan and role.
 * Returns: { sections: [{ title, items: [{ href, label, locked }] }] }
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

    const sections = await loadMoreMenuForUser(tenant.businessId, userId);
    return NextResponse.json({
      sections: sections.map((section) => ({
        title: section.title,
        items: section.items.map((item) => ({ href: item.href, label: item.label, locked: !!item.isLocked })),
      })),
    });
  } catch (error: unknown) {
    console.error('[More navigation] Failed to build menu:', error);
    return NextResponse.json({ error: 'Failed to load menu' }, { status: 500 });
  }
}
