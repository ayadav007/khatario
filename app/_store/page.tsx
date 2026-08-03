'use client';

import { useEffect, useState } from 'react';
import { StoreProvider } from '@/lib/store/store-context';
import { StoreCatalogView } from '@/components/store/StoreCatalogView';

function getSubdomainFromHeaders(): string | null {
  if (typeof window === 'undefined') return null;
  const hostname = window.location.hostname;
  // {subdomain}.khatario.com
  const prodMatch = hostname.match(
    /^([a-z0-9][a-z0-9-]{1,61}[a-z0-9])\.khatario\.com$/,
  );
  if (prodMatch && !['staging', 'app', 'www', 'api'].includes(prodMatch[1])) {
    return prodMatch[1];
  }
  // Dev mode: {subdomain}.localhost
  const devMatch = hostname.match(
    /^([a-z0-9][a-z0-9-]{1,61}[a-z0-9])\.localhost$/,
  );
  if (devMatch && !['staging', 'app', 'www', 'api'].includes(devMatch[1])) {
    return devMatch[1];
  }
  return null;
}

export default function StoreHomePage() {
  const [subdomain, setSubdomain] = useState<string | null>(null);

  useEffect(() => {
    setSubdomain(getSubdomainFromHeaders());
  }, []);

  if (!subdomain) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="text-center">
          <h1 className="text-xl font-semibold text-gray-900">Store not found</h1>
          <p className="mt-2 text-sm text-gray-500">
            This store URL is invalid or no longer active.
          </p>
        </div>
      </div>
    );
  }

  return (
    <StoreProvider subdomain={subdomain}>
      <StoreCatalogView />
    </StoreProvider>
  );
}
