import { NextRequest, NextResponse } from 'next/server';
import { resolveStoreBySubdomain, getStoreBranches } from '@/lib/store/resolve-store';
import { resolveOfflineStoreForPreview } from '@/lib/store/preview-store';

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
    const sp = request.nextUrl.searchParams;
    const td = sp.get('td');
    let store = await resolveStoreBySubdomain(params.subdomain, { allowOffline: Boolean(td) });
    // Engine theme preview of a store not launched yet: only with a token verified for that business.
    if (!store) store = await resolveOfflineStoreForPreview(params.subdomain, sp.get('preview_theme'), sp.get('pt'));
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
