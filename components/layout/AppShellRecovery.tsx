'use client';

import { useEffect } from 'react';
import {
  isStaleChunkError,
  recoverFromStaleShell,
  removeOrphanedBottomNavPortals,
} from '@/lib/shell-recovery';

/**
 * Recovers from stale PWA bundles without interfering with normal App Router
 * client-side navigation.
 */
export function AppShellRecovery() {
  useEffect(() => {
    removeOrphanedBottomNavPortals();
  }, []);

  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      if (isStaleChunkError(event.message ?? '')) {
        void recoverFromStaleShell();
      }
    };

    window.addEventListener('error', onError);
    return () => window.removeEventListener('error', onError);
  }, []);

  return null;
}
