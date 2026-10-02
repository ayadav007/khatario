import { queryOne } from '@/lib/db';
import { listBusinessPaymentProviderIds } from '@/lib/payments';

/** Small facts the editor shows next to settings (items visible, payments set up). */
export async function loadShopFacts(businessId: string): Promise<{ catalogItems: number; paymentsConfigured: boolean }> {
  const [items, methods, providers] = await Promise.all([
    queryOne<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM items
        WHERE business_id = $1 AND deleted_at IS NULL AND (is_active IS NULL OR is_active = true)`,
      [businessId],
    ).catch(() => null),
    queryOne<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM payment_methods WHERE business_id = $1 AND is_active = true`,
      [businessId],
    ).catch(() => null),
    listBusinessPaymentProviderIds(businessId).catch(() => []),
  ]);
  return {
    catalogItems: items?.n ?? 0,
    paymentsConfigured: (methods?.n ?? 0) > 0 || providers.length > 0,
  };
}
