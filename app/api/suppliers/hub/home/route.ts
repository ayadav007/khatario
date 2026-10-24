import { NextRequest, NextResponse } from 'next/server';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { requireAuthenticatedTenant } from '@/lib/stock-request-security';
import { loadHubHome } from '@/lib/supplier-hub-home';

export const dynamic = 'force-dynamic';

async function allowed(userId: string, businessId: string, moduleKey: 'purchases' | 'invoices') {
  try {
    await authorize(userId, moduleKey, 'read', { businessId });
    return true;
  } catch (error) {
    if (error instanceof AuthorizationError) return false;
    throw error;
  }
}

/**
 * GET /api/suppliers/hub/home
 * What is waiting on the signed-in business in the Supplier Hub, as buyer and as supplier, with
 * the counts for the Buying and Selling shortcuts. Each side is included only when the user may
 * read it: buying through purchases, selling through invoices.
 */
export async function GET(request: NextRequest) {
  const auth = requireAuthenticatedTenant(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const [canBuy, canSell] = await Promise.all([
      allowed(auth.userId, auth.businessId, 'purchases'),
      allowed(auth.userId, auth.businessId, 'invoices'),
    ]);
    if (!canBuy && !canSell) {
      return NextResponse.json({ error: 'You do not have access to the Supplier Hub' }, { status: 403 });
    }
    const home = await loadHubHome(auth.businessId);
    return NextResponse.json({
      ...home,
      roles: { buying: canBuy && home.roles.buying, selling: canSell && home.roles.selling },
      access: { buying: canBuy, selling: canSell },
      inbox: home.inbox.filter((i) => (i.side === 'buying' ? canBuy : canSell)),
      buying: canBuy ? home.buying : null,
      selling: canSell ? home.selling : null,
    });
  } catch (error) {
    console.error('supplier hub home GET', error);
    return NextResponse.json({ error: 'Failed to load the Supplier Hub' }, { status: 500 });
  }
}
