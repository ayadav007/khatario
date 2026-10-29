import { headers } from 'next/headers';
import { cache } from 'react';
import { extractStoreSubdomain } from '@/lib/store/subdomain';
import { resolveStoreBySubdomain } from '@/lib/store/resolve-store';

export const currentStore = cache(async () => {
  const subdomain = extractStoreSubdomain(headers().get('host'));
  return subdomain ? resolveStoreBySubdomain(subdomain) : null;
});
