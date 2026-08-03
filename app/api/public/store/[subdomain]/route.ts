import { NextRequest, NextResponse } from 'next/server';
import { resolveStoreBySubdomain, getStoreBranches } from '@/lib/store/resolve-store';

export const dynamic = 'force-dynamic';

/**
 * GET /api/public/store/{subdomain}
 * Resolve a store by subdomain and return business info + branches.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: { subdomain: string } },
) {
  try {
    const store = await resolveStoreBySubdomain(params.subdomain);
    if (!store) {
      return NextResponse.json(
        { error: 'Store not found or not active' },
        { status: 404 },
      );
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
