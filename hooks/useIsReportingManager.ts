'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';

/** Cached check for mobile nav / manager attendance entry. */
export function useIsReportingManager(): boolean | null {
  const { business, user } = useAuth();
  const [isManager, setIsManager] = useState<boolean | null>(null);

  useEffect(() => {
    if (!business?.id || !user?.id) {
      setIsManager(null);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/employees/manager/context', { credentials: 'include' });
        if (!res.ok) {
          if (!cancelled) setIsManager(false);
          return;
        }
        const data = await res.json();
        if (!cancelled) setIsManager(Boolean(data.is_reporting_manager));
      } catch {
        if (!cancelled) setIsManager(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [business?.id, user?.id]);

  return isManager;
}
