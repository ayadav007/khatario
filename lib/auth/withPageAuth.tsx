'use client';

import React, { useEffect } from 'react';
import { useAuthorizationGuard } from '@/hooks/useAuthorizationGuard';
import { AccessDenied } from '@/components/common/AccessDenied';
import { AppLayout } from '@/components/layout/AppLayout';
import { useAuth } from '@/contexts/AuthContext';

/**
 * Higher-Order Component for page-level authorization
 * 
 * Wraps a page component with authorization checks.
 * Acts as a PURE LOGIC GATE - does NOT render loading UI.
 * The page component is responsible for showing loading states.
 * 
 * IMPORTANT: This HOC does NOT render a loading spinner.
 * Pages should handle their own loading UI to prevent duplicate loaders.
 * 
 * @param resource - The resource name (e.g., 'settings', 'invoices')
 * @param action - The action being performed (e.g., 'read', 'create')
 * @param PageComponent - The page component to wrap
 * @returns A new component with authorization guard
 */
export function withPageAuth<T = {}>(
  resource: string,
  action: 'read' | 'create' | 'update' | 'delete' | 'export',
  PageComponent: React.FC<T>
) {
  return function GuardedPage(props: T) {
    const { user, business } = useAuth();
    
    // Use tri-state model from useAuthorizationGuard
    const { status, reason } = useAuthorizationGuard({
      resource,
      action,
      skipCheck: !user?.id || !business?.id,
    });

    // DEV-ONLY: Mark that this page has an auth guard
    useEffect(() => {
      if (process.env.NODE_ENV === 'development') {
        (window as any).__PAGE_HAS_AUTH_GUARD__ = true;
      }
    }, []);

    // While loading, render the page component anyway to avoid blank screens.
    // The server will enforce permissions on actual mutations.
    if (status === 'loading') {
      return <PageComponent {...(props as any)} />;
    }

    // Show denied state ONLY if check completed and denied
    if (status === 'denied') {
      return (
        <AppLayout>
          <AccessDenied
            module={resource}
            action={action}
            details={reason}
            code="PAGE_ACCESS_DENIED"
          />
        </AppLayout>
      );
    }

    // status === 'allowed' - render page component
    return <PageComponent {...(props as any)} />;
  };
}
