import { headers } from 'next/headers';
import { cache } from 'react';
import { extractStoreSubdomain } from '@/lib/store/subdomain';
import { resolveStoreBySubdomain, type StoreBusinessContext } from '@/lib/store/resolve-store';
import { resolveOfflineStoreForPreview } from '@/lib/store/preview-store';

export const currentStore = cache(async () => {
  const subdomain = extractStoreSubdomain(headers().get('host'));
  return subdomain ? resolveStoreBySubdomain(subdomain) : null;
});

/**
 * `currentStore()`, or, for a store that is not launched yet, the store when the request carries a
 * preview token verified for its business and naming an existing `previewTheme` (D10). `offline` marks
 * the second case: such a store may only ever render that preview, never as a normal storefront.
 */
export const currentStoreForPreview = cache(
  async (
    previewTheme: string | null,
    pt: string | null,
  ): Promise<{ store: StoreBusinessContext; offline: boolean } | null> => {
    const store = await currentStore();
    if (store) return { store, offline: false };
    if (!previewTheme || !pt) return null;
    const subdomain = extractStoreSubdomain(headers().get('host'));
    const offline = subdomain ? await resolveOfflineStoreForPreview(subdomain, previewTheme, pt) : null;
    return offline ? { store: offline, offline: true } : null;
  },
);
