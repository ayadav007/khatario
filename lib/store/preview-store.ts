import { resolveStoreBySubdomain, type StoreBusinessContext } from '@/lib/store/resolve-store';
import { resolvePreviewTarget } from '@/lib/store/engine/preview-target';
import { readThemeDraft } from '@/lib/store/theme-draft';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A store that is not launched yet, for an engine theme preview (D10) or a version preview (D47). It resolves only
 * with a preview token signed for this store's business that names exactly `previewTheme`, and only while that theme
 * or version still exists for the business; otherwise null. Callers try the normal (online) lookup first.
 */
export async function resolveOfflineStoreForPreview(
  subdomain: string,
  previewTheme: string | null | undefined,
  pt: string | null | undefined,
): Promise<StoreBusinessContext | null> {
  if (!previewTheme || !pt || !UUID.test(previewTheme)) return null;
  const store = await resolveStoreBySubdomain(subdomain, { allowOffline: true });
  if (!store || store.is_demo) return null;
  return (await resolvePreviewTarget(store.business_id, previewTheme, pt)) ? store : null;
}

/**
 * A store for the public store APIs that the old Studio's draft preview (`td`) also reaches. An online
 * store resolves as always. A store that is not launched yet resolves only when `td` is a live draft
 * token for that store's own business, so a made-up `td` no longer opens an unlaunched store.
 */
export async function resolveStoreWithDraft(
  subdomain: string,
  td: string | null | undefined,
): Promise<StoreBusinessContext | null> {
  const online = await resolveStoreBySubdomain(subdomain);
  if (online || !td) return online;
  const store = await resolveStoreBySubdomain(subdomain, { allowOffline: true });
  if (!store || store.is_demo) return null;
  try {
    return readThemeDraft(td, store.business_id) ? store : null;
  } catch {
    return null; // no signing secret configured: no valid draft
  }
}
