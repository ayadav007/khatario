'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { moduleForPath } from '@/lib/platform-modules';

const ALWAYS_ALLOWED_PREFIXES = ['/settings', '/more', '/profile', '/hr/dashboard'];

function isAlwaysAllowed(pathname: string): boolean {
  return ALWAYS_ALLOWED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/**
 * Redirects users away from module routes they have not enabled yet.
 * Upsell UI comes later; for now we send them to their default home.
 */
export function ModuleShellGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { loading, platformSession } = useAuth();

  useEffect(() => {
    if (loading || !pathname || !platformSession) return;
    if (isAlwaysAllowed(pathname)) return;

    const requiredModule = moduleForPath(pathname);
    if (!requiredModule) return;

    if (!platformSession.enabledModules.includes(requiredModule)) {
      router.replace(`/settings/products?upsell=${requiredModule}`);
    }
  }, [loading, pathname, platformSession, router]);

  return <>{children}</>;
}
