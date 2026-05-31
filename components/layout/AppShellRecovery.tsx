'use client';

import { useEffect } from 'react';
import {
  isStaleChunkError,
  recoverFromStaleShell,
  removeOrphanedBottomNavPortals,
} from '@/lib/shell-recovery';

/**
 * Recovers from stale PWA bundles and falls back to hard navigation when the
 * App Router soft transition does not change the URL (common after bad deploys).
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

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented) return;
      if (event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      const target = event.target;
      if (!(target instanceof Element)) return;

      const anchor = target.closest('a[href]');
      if (!anchor || anchor.getAttribute('target') === '_blank') return;
      if (anchor.hasAttribute('download')) return;

      const href = anchor.getAttribute('href');
      if (!href || !href.startsWith('/') || href.startsWith('//')) return;

      const startPath = `${window.location.pathname}${window.location.search}`;
      const targetUrl = new URL(href, window.location.origin);
      const targetPath = `${targetUrl.pathname}${targetUrl.search}`;
      if (startPath === targetPath) return;

      window.setTimeout(() => {
        const current = `${window.location.pathname}${window.location.search}`;
        if (current !== startPath) return;
        window.location.assign(href);
      }, 800);
    };

    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, []);

  return null;
}
