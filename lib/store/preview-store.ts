import { resolveStoreBySubdomain, type StoreBusinessContext } from '@/lib/store/resolve-store';
import { verifyThemePreview } from '@/lib/store/engine/preview-token';
import { getTheme } from '@/lib/store/engine/themes-repo';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A store that is not launched yet, for an engine theme preview (D10). It resolves only with a
 * preview token signed for this store's business that names exactly `previewTheme`, and only while
 * that theme still exists for the business; otherwise null. Callers try the normal (online) lookup first.
 */
export async function resolveOfflineStoreForPreview(
  subdomain: string,
  previewTheme: string | null | undefined,
  pt: string | null | undefined,
): Promise<StoreBusinessContext | null> {
  if (!previewTheme || !pt || !UUID.test(previewTheme)) return null;
  const store = await resolveStoreBySubdomain(subdomain, { allowOffline: true });
  if (!store || store.is_demo) return null;
  let verified: string | null = null;
  try {
    verified = verifyThemePreview(pt, store.business_id);
  } catch {
    return null; // no signing secret configured: no valid preview
  }
  if (!verified || verified.toLowerCase() !== previewTheme.toLowerCase()) return null;
  return (await getTheme(store.business_id, previewTheme.toLowerCase())) ? store : null;
}
