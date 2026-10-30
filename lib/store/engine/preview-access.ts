import { resolveStoreBySubdomain, type StoreBusinessContext } from '@/lib/store/resolve-store';
import { resolveOfflineStoreForPreview } from '@/lib/store/preview-store';

/**
 * Store lookup for the public storefront data APIs (items, facets, related, reviews).
 * An online store resolves as always, and a draft-preview token (`td`) still allows an offline store.
 * Otherwise an unlaunched store resolves only for an engine theme preview whose token
 * (`preview_theme` + `pt`) is verified for that store's business and names a theme that still exists.
 */
export async function storeForPublicApi(
  subdomain: string,
  sp: URLSearchParams,
): Promise<StoreBusinessContext | null> {
  const store = await resolveStoreBySubdomain(subdomain, { allowOffline: Boolean(sp.get('td')) });
  if (store) return store;
  return resolveOfflineStoreForPreview(subdomain, sp.get('preview_theme'), sp.get('pt'));
}
