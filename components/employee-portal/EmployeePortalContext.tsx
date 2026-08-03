'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import type { EmployeePortalEntitlements } from '@/lib/employee-portal/feature-gates';

export type EmployeePortalSessionState = {
  employee: { id: string; name: string; employee_code: string };
  business: { id: string; name: string; logo_url: string | null; portal_slug: string };
  entitlements: EmployeePortalEntitlements & { team?: boolean };
  is_manager?: boolean;
  must_change_password?: boolean;
};

type Ctx = {
  slug: string;
  session: EmployeePortalSessionState | null;
  loading: boolean;
  portalEnabled: boolean | null;
  kioskEnabled: boolean | null;
  businessMeta: { name: string; logo_url: string | null } | null;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
};

const EmployeePortalContext = createContext<Ctx | null>(null);

export function EmployeePortalProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const params = useParams();
  const slug = String(params?.slug ?? '')
    .trim()
    .toLowerCase();
  const [session, setSession] = useState<EmployeePortalSessionState | null>(null);
  const [loading, setLoading] = useState(true);
  const [portalEnabled, setPortalEnabled] = useState<boolean | null>(null);
  const [kioskEnabled, setKioskEnabled] = useState<boolean | null>(null);
  const [businessMeta, setBusinessMeta] = useState<{ name: string; logo_url: string | null } | null>(
    null
  );

  const refresh = useCallback(async () => {
    if (!slug) {
      setSession(null);
      setPortalEnabled(false);
      setKioskEnabled(false);
      setBusinessMeta(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const metaRes = await fetch(`/api/public/employee/${encodeURIComponent(slug)}`);
      if (metaRes.ok) {
        const meta = await metaRes.json();
        setPortalEnabled(meta.portal_enabled);
        setKioskEnabled(meta.kiosk_enabled !== false);
        setBusinessMeta({
          name: meta.business?.name ?? '',
          logo_url: meta.business?.logo_url ?? null,
        });
      }

      const meRes = await fetch('/api/public/employee/session/me', { credentials: 'include' });
      if (meRes.ok) {
        const data = await meRes.json();
        setSession(data);
      } else {
        setSession(null);
      }
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const logout = useCallback(async () => {
    await fetch('/api/public/employee/session/logout', {
      method: 'POST',
      credentials: 'include',
    });
    setSession(null);
  }, []);

  const value = useMemo(
    () => ({ slug, session, loading, portalEnabled, kioskEnabled, businessMeta, refresh, logout }),
    [slug, session, loading, portalEnabled, kioskEnabled, businessMeta, refresh, logout]
  );

  return (
    <EmployeePortalContext.Provider value={value}>{children}</EmployeePortalContext.Provider>
  );
}

export function useEmployeePortal() {
  const ctx = useContext(EmployeePortalContext);
  if (!ctx) throw new Error('useEmployeePortal must be used within EmployeePortalProvider');
  return ctx;
}
