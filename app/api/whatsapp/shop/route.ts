import { NextResponse } from 'next/server';
import { withWhatsAppPremiumApi } from '@/lib/security/premium-module-api';
import { enableWhatsAppCommerce, getCatalogInfo, getMetaWaConfig, MetaWhatsAppError } from '@/lib/meta-whatsapp';
import { saveShopSettings, type ShopSettingsInput } from '@/lib/whatsapp-shop/settings';
import { loadShopStatus } from '@/lib/whatsapp-shop/status';

export const dynamic = 'force-dynamic';

/** GET /api/whatsapp/shop: WhatsApp shop settings plus what the editor needs to show. */
export const GET = withWhatsAppPremiumApi({ module: 'whatsapp', action: 'read' }, async ({ businessId }) => {
  try {
    return NextResponse.json(await loadShopStatus(businessId));
  } catch (error) {
    console.error('[whatsapp-shop] load failed:', error);
    return NextResponse.json({ error: 'Failed to load WhatsApp shop settings' }, { status: 500 });
  }
});

/**
 * PUT /api/whatsapp/shop: saves settings. A new catalog ID is checked against Meta with the
 * business's own token, connected to its WABA, and the cart is switched on for its number.
 */
export const PUT = withWhatsAppPremiumApi(
  { module: 'whatsapp', action: 'update', parseJsonBody: true },
  async ({ businessId, body }) => {
    const b = (body ?? {}) as Record<string, unknown>;
    const input: ShopSettingsInput = {
      ...(typeof b.enabled === 'boolean' ? { enabled: b.enabled } : {}),
      ...(b.metaCatalogId !== undefined ? { metaCatalogId: b.metaCatalogId === null ? null : String(b.metaCatalogId) } : {}),
      ...(b.itemScope === 'all' || b.itemScope === 'store' ? { itemScope: b.itemScope } : {}),
      ...(typeof b.hideOutOfStock === 'boolean' ? { hideOutOfStock: b.hideOutOfStock } : {}),
      ...(typeof b.welcomeText === 'string' ? { welcomeText: b.welcomeText } : {}),
    };

    const warnings: string[] = [];
    try {
      const before = await loadShopStatus(businessId);
      const enabling = input.enabled === true || (input.enabled === undefined && before.settings.enabled);
      if (enabling && !before.gatewayConfigured) {
        return NextResponse.json(
          {
            error:
              'Connect a payment gateway (e.g. Razorpay) before taking WhatsApp orders. Manual UPI alone is not enough.',
            code: 'NO_GATEWAY',
          },
          { status: 400 },
        );
      }
      const catalogId = typeof input.metaCatalogId === 'string' ? input.metaCatalogId.trim() : null;
      if (catalogId && catalogId !== before.settings.metaCatalogId) {
        if (!(await getMetaWaConfig(businessId))) {
          return NextResponse.json(
            { error: 'Connect the WhatsApp Cloud API first. The native catalog only works on Cloud API numbers.' },
            { status: 400 },
          );
        }
        try {
          await getCatalogInfo({ businessId, catalogId });
        } catch (e) {
          const msg = e instanceof MetaWhatsAppError ? e.message : 'Meta did not respond';
          return NextResponse.json(
            { error: `Meta couldn't open that catalog with your WhatsApp token: ${msg}. Check the ID and that the token has catalog_management permission.` },
            { status: 400 },
          );
        }
        warnings.push(...(await enableWhatsAppCommerce({ businessId, catalogId })).warnings);
      }
      await saveShopSettings(businessId, input);
      return NextResponse.json({ ...(await loadShopStatus(businessId)), warnings });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save';
      return NextResponse.json({ error: message }, { status: 400 });
    }
  },
);
