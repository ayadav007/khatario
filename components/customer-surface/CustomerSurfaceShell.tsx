'use client';

import type { PublicBusinessSurface } from '@/lib/customer-surface/types';
import { CustomerSurfacePromoBanner } from './CustomerSurfacePromo';
import { CustomerSurfacePlatformAd } from './CustomerSurfacePlatformAd';

interface CustomerSurfaceShellProps {
  business: PublicBusinessSurface;
  children: React.ReactNode;
  footerExtra?: React.ReactNode;
}

export function CustomerSurfaceShell({
  business,
  children,
  footerExtra,
}: CustomerSurfaceShellProps) {
  const promo = business.surface_settings?.promo;

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-border bg-white">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-4">
          {business.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={business.logo_url}
              alt=""
              className="h-10 w-10 rounded-md object-contain"
            />
          ) : (
            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-gray-100 text-sm font-semibold text-gray-700">
              {business.name.slice(0, 1).toUpperCase()}
            </div>
          )}
          <div>
            <p className="font-semibold text-text-primary">{business.name}</p>
            {business.phone ? (
              <p className="text-xs text-text-secondary">{business.phone}</p>
            ) : null}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-4 px-4 py-6">
        {promo?.enabled ? <CustomerSurfacePromoBanner promo={promo} /> : null}
        {children}
        {business.show_platform_ad ? <CustomerSurfacePlatformAd /> : null}
        {footerExtra}
      </main>

      <footer className="border-t border-border py-6 text-center text-xs text-text-muted">
        Powered by Khatario
      </footer>
    </div>
  );
}
