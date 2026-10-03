import { NextResponse } from 'next/server';
import { withWhatsAppPremiumApi } from '@/lib/security/premium-module-api';
import { MetaWhatsAppError } from '@/lib/meta-whatsapp';
import { checkRateLimit } from '@/lib/rate-limit';
import { ShopSyncError, syncShopCatalog } from '@/lib/whatsapp-shop/sync';
import { loadShopStatus } from '@/lib/whatsapp-shop/status';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/** POST /api/whatsapp/shop/sync: push shop items to the business's Meta catalog. */
export const POST = withWhatsAppPremiumApi(
  { module: 'whatsapp', action: 'update', parseJsonBody: true },
  async ({ businessId, body }) => {
    const rl = checkRateLimit(`wa-shop-sync:${businessId}`, 6, 10 * 60_000);
    if (!rl.allowed) return NextResponse.json({ error: 'Too many syncs. Try again in a few minutes.' }, { status: 429 });
    try {
      const force = (body as { force?: unknown } | null)?.force === true;
      const summary = await syncShopCatalog(businessId, { force });
      return NextResponse.json({ summary, status: await loadShopStatus(businessId) });
    } catch (error) {
      if (error instanceof ShopSyncError) {
        return NextResponse.json({ error: error.message, code: error.code }, { status: 400 });
      }
      if (error instanceof MetaWhatsAppError) {
        return NextResponse.json({ error: `Meta rejected the sync: ${error.message}` }, { status: 502 });
      }
      console.error('[whatsapp-shop] sync failed:', error);
      return NextResponse.json({ error: 'Catalog sync failed' }, { status: 500 });
    }
  },
);
