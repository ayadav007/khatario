'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { StoreProvider } from '@/lib/store/store-context';
import { extractStoreSubdomain } from '@/lib/store/subdomain';
import { StorePromoSheet } from '@/components/store/StorePromoSheet';

export function StoreApp({ children }: { children: ReactNode }) {
  const [subdomain, setSubdomain] = useState<string | null>(null);

  useEffect(() => {
    setSubdomain(extractStoreSubdomain(window.location.host));
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
      <StorePromoSheet />
      {children}
    </StoreProvider>
  );
}
