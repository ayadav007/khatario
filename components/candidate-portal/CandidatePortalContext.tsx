'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';

export type CandidatePortalSessionState = {
  candidate: { id: string; name: string; email: string; status: string; job_title: string };
  business: { id: string; name: string; logo_url: string | null };
};

type Ctx = {
  slug: string;
  session: CandidatePortalSessionState | null;
  loading: boolean;
  businessMeta: { name: string; logo_url: string | null } | null;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
};

const CandidatePortalContext = createContext<Ctx | null>(null);

export function CandidatePortalProvider({ children }: { children: React.ReactNode }) {
  const params = useParams();
  const slug = String(params?.slug ?? '').trim().toLowerCase();
  const [session, setSession] = useState<CandidatePortalSessionState | null>(null);
  const [loading, setLoading] = useState(true);
  const [businessMeta, setBusinessMeta] = useState<{ name: string; logo_url: string | null } | null>(null);

  const refresh = useCallback(async () => {
    if (!slug) {
      setSession(null);
      setBusinessMeta(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const metaRes = await fetch(`/api/public/candidate/${encodeURIComponent(slug)}`);
      if (metaRes.ok) {
        const meta = await metaRes.json();
        setBusinessMeta({
          name: meta.business?.name ?? '',
          logo_url: meta.business?.logo_url ?? null,
        });
      }

      const meRes = await fetch('/api/public/candidate/session/me', { credentials: 'include' });
      if (meRes.ok) {
        const data = await meRes.json();
        setSession({ candidate: data.candidate, business: data.business });
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
    await fetch('/api/public/candidate/session/logout', {
      method: 'POST',
      credentials: 'include',
    });
    setSession(null);
  }, []);

  const value = useMemo(
    () => ({ slug, session, loading, businessMeta, refresh, logout }),
    [slug, session, loading, businessMeta, refresh, logout],
  );

  return <CandidatePortalContext.Provider value={value}>{children}</CandidatePortalContext.Provider>;
}

export function useCandidatePortal() {
  const ctx = useContext(CandidatePortalContext);
  if (!ctx) throw new Error('useCandidatePortal must be used within CandidatePortalProvider');
  return ctx;
}
