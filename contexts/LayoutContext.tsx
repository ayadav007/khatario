'use client';

import { useRenderLoopProbe } from '@/lib/debug/render-loop-detector';

import React, { createContext, useContext, useState, useEffect, useLayoutEffect, useCallback, useMemo, useRef } from 'react';
import { usePathname } from 'next/navigation';

interface LayoutContextType {
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleSidebar: () => void;
}

const LayoutContext = createContext<LayoutContextType>({
  sidebarCollapsed: false,
  setSidebarCollapsed: () => {},
  toggleSidebar: () => {},
});

const SIDEBAR_COLLAPSED_KEY = 'khatario.sidebar-collapsed';

function isConversationsPath(path: string | null | undefined): boolean {
  return Boolean(path?.includes('/whatsapp/conversations'));
}

function readStoredCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

function writeStoredCollapsed(collapsed: boolean) {
  try {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? '1' : '0');
  } catch {
    /* private mode / blocked storage */
  }
}

export const useLayout = () => useContext(LayoutContext);

export function LayoutProvider({ children }: { children: React.ReactNode }) {
  useRenderLoopProbe('LayoutProvider');
  const [sidebarCollapsed, setSidebarCollapsedState] = useState(false);
  const pathname = usePathname();
  const preferredCollapsedRef = useRef(false);
  const pathnameRef = useRef(pathname);

  useLayoutEffect(() => {
    const stored = readStoredCollapsed();
    preferredCollapsedRef.current = stored;
    setSidebarCollapsedState(isConversationsPath(pathnameRef.current) ? true : stored);
  }, []);

  // Conversations wants the menu out of the way. Leaving that screen restores
  // the choice the user made everywhere else. Other navigations leave it alone.
  useEffect(() => {
    const previous = pathnameRef.current;
    pathnameRef.current = pathname;
    const wasConversations = isConversationsPath(previous);
    const nowConversations = isConversationsPath(pathname);
    if (!wasConversations && nowConversations) {
      setSidebarCollapsedState(true);
    } else if (wasConversations && !nowConversations) {
      setSidebarCollapsedState(preferredCollapsedRef.current);
    }
  }, [pathname]);

  // Display-only. The product tour calls this to open the menu for a spotlight
  // and must not overwrite the collapsed choice saved by toggleSidebar.
  const setSidebarCollapsed = useCallback((collapsed: boolean) => {
    setSidebarCollapsedState(collapsed);
  }, []);

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsedState((prev) => {
      const next = !prev;
      if (!isConversationsPath(pathnameRef.current)) {
        preferredCollapsedRef.current = next;
        writeStoredCollapsed(next);
      }
      return next;
    });
  }, []);

  const value = useMemo<LayoutContextType>(
    () => ({ sidebarCollapsed, setSidebarCollapsed, toggleSidebar }),
    [sidebarCollapsed, setSidebarCollapsed, toggleSidebar]
  );

  return (
    <LayoutContext.Provider value={value}>
      {children}
    </LayoutContext.Provider>
  );
}
