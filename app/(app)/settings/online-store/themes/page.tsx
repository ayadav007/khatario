'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2, Palette } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { usePermissions } from '@/hooks/usePermissions';
import { SettingsPageShell } from '@/components/settings/SettingsPageShell';
import { ThemeLibrary } from '@/components/store/library/ThemeLibrary';
import { NO_EDIT_NOTICE } from '@/lib/store/engine/library';

/** D39: the theme library. Reads `store_engine` from the Online store settings (D52); the API checks permission too. */
export default function ThemeLibraryPage() {
  const { business, user } = useAuth();
  const { canView, canModify, isPrimaryAdmin, loading: permissionsLoading } = usePermissions();
  // No user yet means permissions are still loading too (N1), not that they are missing.
  const ready = !permissionsLoading && !!user;
  const mayView = ready ? canView('settings') || isPrimaryAdmin : null;
  const mayEdit = ready ? canModify('settings') || isPrimaryAdmin : null;
  const [storeEngine, setStoreEngine] = useState<boolean | null>(null);

  useEffect(() => {
    if (mayView !== true || !business?.id) return;
    let cancelled = false;
    (async () => {
      let on = false;
      try {
        // The business comes from the session; only store_engine is read.
        const res = await fetch('/api/settings/online-store', { credentials: 'include' });
        if (res.ok) on = (await res.json())?.store_engine === true;
      } catch {
        /* treated as off: the notice then errs on the side of telling the merchant */
      }
      if (!cancelled) setStoreEngine(on);
    })();
    return () => {
      cancelled = true;
    };
  }, [mayView, business?.id]);

  if (mayView === false) {
    return (
      <SettingsPageShell title="Themes" icon={Palette}>
        <div role="note" className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700">
          {NO_EDIT_NOTICE}
        </div>
        <Link href="/settings" className="text-sm text-gray-700 underline">
          Back to Settings
        </Link>
      </SettingsPageShell>
    );
  }

  if (mayView === null || mayEdit === null || storeEngine === null || !business?.id) {
    return (
      <SettingsPageShell title="Themes" icon={Palette}>
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
        </div>
      </SettingsPageShell>
    );
  }

  return <ThemeLibrary businessId={business.id} canEdit={mayEdit} storeEngine={storeEngine} />;
}
