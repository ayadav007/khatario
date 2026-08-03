'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import type { PlatformModule } from '@/lib/platform-modules';
import {
  canAccessSettingsPath,
  settingsPathDeniedRedirect,
} from '@/lib/settings-route-access';
import { Loader2 } from 'lucide-react';

export function SettingsModuleGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { platformSession, loading } = useAuth();

  const enabledModules: PlatformModule[] =
    platformSession?.enabledModules ?? (['billing'] as PlatformModule[]);

  const allowed =
    !pathname || canAccessSettingsPath(pathname, enabledModules);

  useEffect(() => {
    if (loading || !pathname || allowed) return;
    router.replace(settingsPathDeniedRedirect(enabledModules));
  }, [loading, pathname, allowed, router, enabledModules]);

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-text-muted" />
      </div>
    );
  }

  if (!allowed) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center px-4 text-center">
        <p className="text-sm text-text-secondary">
          This settings page is not available on your current products.
        </p>
      </div>
    );
  }

  return <>{children}</>;
}
