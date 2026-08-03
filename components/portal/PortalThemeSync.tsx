'use client';

import { useLayoutEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import {
  applyPortalThemeToElement,
  clearPortalThemeFromElement,
  DEFAULT_PORTAL_THEME,
} from '@/lib/portal-theme';
import {
  persistPortalThemeToClientStorage,
  readBusinessIdFromClientStorage,
} from '@/lib/portal-theme-storage';

/**
 * Applies organization portal_theme CSS variables on <html> while the authenticated app shell is mounted.
 * useLayoutEffect + boot script avoid a flash of default teal before the business theme loads.
 */
export function PortalThemeSync() {
  const { portalTheme } = useAuth();

  useLayoutEffect(() => {
    if (typeof document === 'undefined') return;
    const el = document.documentElement;
    const effective = portalTheme ?? DEFAULT_PORTAL_THEME;
    applyPortalThemeToElement(el, effective);

    const businessId = readBusinessIdFromClientStorage();
    if (businessId && portalTheme) {
      try {
        persistPortalThemeToClientStorage(portalTheme, businessId);
      } catch {
        /* ignore quota errors */
      }
    }

    return () => {
      clearPortalThemeFromElement(el);
    };
  }, [portalTheme]);

  return null;
}
