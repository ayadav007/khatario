import { NextRequest, NextResponse } from 'next/server';
import { resolveStoreBySubdomain } from '@/lib/store/resolve-store';
import { readStoreCustomer, STORE_CUSTOMER_COOKIE } from '@/lib/store/customer-session';
import { loadBuyAgainItems } from '@/lib/store/buy-again';
import { storeOosPlace } from '@/lib/store/engine/oos-place';
import { isUuid } from '@/lib/store/review-http';

export const dynamic = 'force-dynamic';

/** Per shopper: never stored by a browser or proxy cache. */
const PRIVATE = { 'Cache-Control': 'private, no-store' };

/**
 * GET /api/public/store/{subdomain}/buy-again[?branch_id=uuid]
 * The signed-in shopper's own previously ordered products in this store, newest first, each pack its own entry:
 * `{ items: (StoreItem & { buy_again_variant_id })[] }`. The business comes from the store and the shopper from the
 * session cookie (it must belong to this business); no session gives `{ items: [] }`. Demo stores show their
 * catalogue's sample list.
 */
export async function GET(request: NextRequest, { params }: { params: { subdomain: string } }) {
  try {
    const store = await resolveStoreBySubdomain(params.subdomain);
    if (!store) return NextResponse.json({ error: 'Store not found' }, { status: 404, headers: PRIVATE });

    if (store.is_demo) {
      const { DEMO_BUY_AGAIN, demoCatalog } = await import('@/lib/store/engine/demo-catalogs');
      const catalogId = store.demo_catalog;
      const products = catalogId ? demoCatalog(catalogId).products : [];
      const items = (catalogId ? DEMO_BUY_AGAIN[catalogId] ?? [] : [])
        .map((id) => products.find((p) => p.id === id))
        .filter((p): p is NonNullable<typeof p> => !!p)
        .map((p) => ({ ...p, buy_again_variant_id: null }));
      return NextResponse.json({ items }, { headers: PRIVATE });
    }

    const session = readStoreCustomer(request.cookies.get(STORE_CUSTOMER_COOKIE)?.value);
    if (!session || session.businessId !== store.business_id) {
      return NextResponse.json({ items: [] }, { headers: PRIVATE });
    }

    const { searchParams } = request.nextUrl;
    const rawBranch = searchParams.get('branch_id');
    const items = await loadBuyAgainItems({
      businessId: store.business_id,
      customerId: session.customerId,
      branchId: isUuid(rawBranch) ? rawBranch : null,
      outOfStock: await storeOosPlace(store, searchParams),
    });
    return NextResponse.json({ items }, { headers: PRIVATE });
  } catch (error) {
    console.error('[store buy-again]', error);
    return NextResponse.json({ error: 'Failed to load' }, { status: 500, headers: PRIVATE });
  }
}
