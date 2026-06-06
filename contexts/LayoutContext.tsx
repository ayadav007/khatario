'use client';

import { useRenderLoopProbe } from '@/lib/debug/render-loop-detector';

import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
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

export const useLayout = () => useContext(LayoutContext);

export function LayoutProvider({ children }: { children: React.ReactNode }) {
  useRenderLoopProbe('LayoutProvider');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const pathname = usePathname();

  // Auto-collapse logic based on route
  useEffect(() => {
    const autoCollapseRoutes = [
      '/whatsapp/conversations' // Collapse sidebar for conversations page
    ];
    
    const shouldCollapse = autoCollapseRoutes.some(route => pathname?.includes(route));
    
    setSidebarCollapsed((prev) => {
      const next = shouldCollapse;
      return prev === next ? prev : next;
    });
  }, [pathname]);

  const toggleSidebar = useCallback(() => setSidebarCollapsed(prev => !prev), []);

  const value = useMemo<LayoutContextType>(
    () => ({ sidebarCollapsed, setSidebarCollapsed, toggleSidebar }),
    [sidebarCollapsed, toggleSidebar]
  );

  return (
    <LayoutContext.Provider value={value}>
      {children}
    </LayoutContext.Provider>
  );
}

