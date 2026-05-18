'use client';

import { useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import {
  applyPortalThemeToElement,
  clearPortalThemeFromElement,
  DEFAULT_PORTAL_THEME,
} from '@/lib/portal-theme';

/**
 * Applies organization portal_theme CSS variables on <html> while the authenticated app shell is mounted.
 * Unmount clears vars so marketing/login/admin surfaces keep default product styling.
 */
export function PortalThemeSync() {
  const { portalTheme } = useAuth();

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const el = document.documentElement;
    const effective = portalTheme ?? DEFAULT_PORTAL_THEME;
    applyPortalThemeToElement(el, effective);
    return () => {
      clearPortalThemeFromElement(el);
    };
  }, [portalTheme]);

  return null;
}
