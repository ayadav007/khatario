import { headers } from 'next/headers';
import { cache } from 'react';
import { extractStoreSubdomain } from '@/lib/store/subdomain';
import { resolveStoreBySubdomain } from '@/lib/store/resolve-store';
import { resolveOfflineStoreForPreview } from '@/lib/store/preview-store';

export const currentStore = cache(async () => {
  const subdomain = extractStoreSubdomain(headers().get('host'));
  return subdomain ? resolveStoreBySubdomain(subdomain) : null;
});

/**
 * `currentStore()`, or, for a store that is not launched yet, the store when the request carries a
 * preview token verified for its business and naming `previewTheme` (D10).
 */
export const currentStoreForPreview = cache(async (previewTheme: string | null, pt: string | null) => {
  const store = await currentStore();
  if (store || !previewTheme || !pt) return store;
  const subdomain = extractStoreSubdomain(headers().get('host'));
  return subdomain ? resolveOfflineStoreForPreview(subdomain, previewTheme, pt) : null;
});
