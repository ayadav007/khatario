import { NextRequest, NextResponse } from 'next/server';
import { resolveStoreBySubdomain, getStoreBranches } from '@/lib/store/resolve-store';

export const dynamic = 'force-dynamic';

/**
 * GET /api/public/store/{subdomain}
 * Resolve a store by subdomain and return business info + branches.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { subdomain: string } },
) {
  try {
    const td = request.nextUrl.searchParams.get('td');
    const store = await resolveStoreBySubdomain(params.subdomain, { allowOffline: Boolean(td) });
    if (!store) {
      return NextResponse.json(
        { error: 'Store not found or not active' },
        { status: 404 },
      );
    }

    if (td && !store.is_demo) {
      const { readThemeDraft } = await import('@/lib/store/theme-draft');
      const draft = readThemeDraft(td, store.business_id);
      if (draft) store.store_theme = draft;
    }

    const branches = await getStoreBranches(store.business_id);

    return NextResponse.json({ store, branches });
  } catch (error) {
    console.error('[store resolve]', error);
    return NextResponse.json(
      { error: 'Failed to load store' },
      { status: 500 },
    );
  }
}
