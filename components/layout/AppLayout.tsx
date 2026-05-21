'use client';

import React, { useEffect } from 'react';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { BottomNav } from './BottomNav';
import { DynamicTitle } from './DynamicTitle';
import { PromotionModal } from '../promotions/PromotionModal';
import { useLayout } from '@/contexts/LayoutContext';
import { usePathname } from 'next/navigation';
import { clsx } from 'clsx';
import { APP_MAIN_PADDING_CLASS } from '@/lib/page-layout';

interface AppLayoutProps {
  children: React.ReactNode;
  showDateRange?: boolean;
  onDateRangeChange?: (range: { start: string; end: string; label: string }) => void;
}

export const AppLayout: React.FC<AppLayoutProps> = ({
  children,
  showDateRange = false,
  onDateRangeChange,
}) => {
  const { sidebarCollapsed } = useLayout();
  const pathname = usePathname();
  
  // DEV-ONLY: Warn if page rendered without authorization guard
  useEffect(() => {
    if (process.env.NODE_ENV === 'development') {
      // Skip warning for public/auth pages
      const publicPaths = ['/login', '/signup', '/auth', '/public', '/invoices/[id]/view'];
      const isPublicPath = publicPaths.some(path => pathname?.includes(path));
      
      if (!isPublicPath && typeof window !== 'undefined') {
        // Check if page has auth guard (set by withPageAuth)
        const hasAuthGuard = (window as any).__PAGE_HAS_AUTH_GUARD__;
        if (!hasAuthGuard) {
          console.warn(
            '[SECURITY] Page rendered without authorization guard:',
            pathname
          );
        }
        // Reset flag for next navigation
        (window as any).__PAGE_HAS_AUTH_GUARD__ = false;
      }
    }
  }, [pathname]);
  
  // Full-width pages (no padding, no top bar)
  const isFullWidthPage = pathname?.includes('/whatsapp/conversations');

  return (
    <div className="min-h-screen min-w-0 max-w-full overflow-x-hidden bg-background">
      <DynamicTitle />
      <Sidebar />
      <div 
        className={clsx(
          "min-w-0 max-w-full overflow-x-hidden transition-all duration-300 ease-in-out",
          sidebarCollapsed ? "lg:ml-16" : "lg:ml-64"
        )}
      >
        {/* TopBar & PromotionBanner: rendered by app/(app)/layout.tsx to prevent duplication */}
        <main className={clsx(
          "min-w-0",
          isFullWidthPage ? "h-screen" : APP_MAIN_PADDING_CLASS
        )}>
          {children}
        </main>
      </div>
      {!isFullWidthPage && <BottomNav />}
      <PromotionModal />
    </div>
  );
};
