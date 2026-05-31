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
    
    // Check if current path matches any of the auto-collapse patterns
    const shouldCollapse = autoCollapseRoutes.some(route => pathname?.includes(route));
    
    if (shouldCollapse) {
      setSidebarCollapsed(true);
    } else {
      // Restore to default (expanded) when leaving these pages
      // This ensures sidebar is expanded when navigating to other pages
      setSidebarCollapsed(false);
    }
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

