import { resolveStoreBySubdomain, type StoreBusinessContext } from '@/lib/store/resolve-store';
import { verifyThemePreview } from '@/lib/store/engine/preview-token';

/**
 * A store that is not launched yet, for an engine theme preview (D10). It resolves only with a
 * preview token signed for this store's business that names exactly `previewTheme`; otherwise null.
 * Callers try the normal (online) lookup first.
 */
export async function resolveOfflineStoreForPreview(
  subdomain: string,
  previewTheme: string | null | undefined,
  pt: string | null | undefined,
): Promise<StoreBusinessContext | null> {
  if (!previewTheme || !pt) return null;
  const store = await resolveStoreBySubdomain(subdomain, { allowOffline: true });
  if (!store || store.is_demo) return null;
  let verified: string | null = null;
  try {
    verified = verifyThemePreview(pt, store.business_id);
  } catch {
    return null; // no signing secret configured: no valid preview
  }
  return verified && verified.toLowerCase() === previewTheme.toLowerCase() ? store : null;
}
