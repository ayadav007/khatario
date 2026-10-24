import { queryOne } from '@/lib/db';
import { loadShopFacts } from '@/lib/ai-agent/shop-facts';
import { listBusinessPaymentProviderIds } from '@/lib/payments';
import { businessTransport } from '@/lib/whatsapp/business-transport';
import { loadShopItems, shopImageUrl } from './items';
import { getShopSettings, type ShopSettings } from './settings';

export type ShopStatus = {
  settings: ShopSettings;
  /** How the business's number is connected; only 'cloud' can show the native catalog. */
  transport: 'cloud' | 'baileys';
  items: number;
  itemsWithoutImage: number;
  syncedItems: number;
  paymentsConfigured: boolean;
  /** A payment gateway can confirm payment automatically; UPI alone needs a screenshot. */
  gatewayConfigured: boolean;
};

export async function loadShopStatus(businessId: string): Promise<ShopStatus> {
  const settings = await getShopSettings(businessId);
  const [transport, items, synced, facts, providers] = await Promise.all([
    businessTransport(businessId),
    loadShopItems(businessId, settings),
    queryOne<{ n: number }>(`SELECT COUNT(*)::int AS n FROM whatsapp_catalog_items WHERE business_id = $1`, [businessId]).catch(
      () => null,
    ),
    loadShopFacts(businessId),
    listBusinessPaymentProviderIds(businessId).catch(() => []),
  ]);
  return {
    settings,
    transport,
    items: items.length,
    itemsWithoutImage: items.filter((i) => !shopImageUrl(i)).length,
    syncedItems: synced?.n ?? 0,
    paymentsConfigured: facts.paymentsConfigured,
    gatewayConfigured: providers.length > 0,
  };
}
