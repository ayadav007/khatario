'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { User, Business } from '@/types/database';
import { clearAllBranchStorage } from '@/lib/branch-storage';
import { mergePortalTheme, type PortalTheme } from '@/lib/portal-theme';
import { markLocalSessionCookie } from '@/lib/auth/local-session-cookie';
import { shouldTrustCachedSession } from '@/lib/auth/should-trust-cached-session';
import { NETWORK_RECONNECT_EVENT } from '@/lib/network/events';
import { useNetworkStatusContext } from '@/contexts/NetworkStatusContext';
import { isCapacitorNative } from '@/lib/capacitor/platform';

/** Legacy unscoped key — migrated away on successful session fetch to prevent cross-business bleed. */
const PORTAL_THEME_LEGACY_KEY = 'portalTheme';

function portalThemeStorageKey(businessId: string): string {
  return `${PORTAL_THEME_LEGACY_KEY}:${businessId}`;
}

function removeAllPortalThemeStorageKeys(): void {
  try {
    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      if (k === PORTAL_THEME_LEGACY_KEY || k.startsWith(`${PORTAL_THEME_LEGACY_KEY}:`)) {
        toRemove.push(k);
      }
    }
    for (const k of toRemove) localStorage.removeItem(k);
  } catch {
    /* ignore */
  }
}

function persistPortalThemeFromSession(portalTheme: PortalTheme, businessId: string): void {
  localStorage.setItem(portalThemeStorageKey(businessId), JSON.stringify(portalTheme));
  localStorage.removeItem(PORTAL_THEME_LEGACY_KEY);
}

export interface SessionPermissions {
  [moduleKey: string]: {
    can_view: boolean;
    can_add: boolean;
    can_modify: boolean;
    can_delete: boolean;
    can_share: boolean;
  };
}

interface AuthContextType {
  user: User | null;
  business: Business | null;
  branch: any | null;
  branches: any[];
  /** Active branches for this business (not only the user's assignments). From session. */
  activeBranchCount: number;
  permissions: SessionPermissions;
  isPrimaryAdmin: boolean;
  subscription: any | null;
  /** Organization portal appearance from session (always defined when user has a business). */
  portalTheme: PortalTheme | null;
  loading: boolean;
  login: (userData: any) => Promise<void>;
  logout: () => void;
  refresh: () => Promise<void>;
  /** Restore session from localStorage (offline escape hatch). */
  restoreCachedSession: () => boolean;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  business: null,
  branch: null,
  branches: [],
  activeBranchCount: 0,
  permissions: {},
  isPrimaryAdmin: false,
  subscription: null,
  portalTheme: null,
  loading: true,
  login: async () => {},
  logout: () => {},
  refresh: async () => {},
  restoreCachedSession: () => false,
});

export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { networkReady } = useNetworkStatusContext();
  const [user, setUser] = useState<User | null>(null);
  const [business, setBusiness] = useState<Business | null>(null);
  const [branch, setBranch] = useState<any | null>(null);
  const [branches, setBranches] = useState<any[]>([]);
  const [activeBranchCount, setActiveBranchCount] = useState(0);
  const [permissions, setPermissions] = useState<SessionPermissions>({});
  const [isPrimaryAdmin, setIsPrimaryAdmin] = useState(false);
  const [subscription, setSubscription] = useState<any | null>(null);
  const [portalTheme, setPortalTheme] = useState<PortalTheme | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const pathname = usePathname();
  /** Bumped on login/logout so stale in-flight /api/auth/session calls cannot revoke a new session. */
  const sessionGenerationRef = useRef(0);
  const authBootstrappedRef = useRef(false);

  if (
    typeof window !== 'undefined' &&
    localStorage.getItem('user')
  ) {
    markLocalSessionCookie(true);
  }

  const loadFromCache = () => {
    const storedUser = localStorage.getItem('user');
    const storedBusiness = localStorage.getItem('business');
    const storedBranch = localStorage.getItem('branch');
    const storedPermissions = localStorage.getItem('permissions');
    const storedBranches = localStorage.getItem('branches');
    const storedIsAdmin = localStorage.getItem('isPrimaryAdmin');
    if (storedUser) setUser(JSON.parse(storedUser));
    if (storedBusiness) {
      const b = JSON.parse(storedBusiness);
      setBusiness(b);
      if (b?.id) {
        try {
          localStorage.setItem('businessId', b.id);
        } catch {
          /* ignore */
        }
      }
    }
    if (storedBranch) setBranch(JSON.parse(storedBranch));
    if (storedPermissions) setPermissions(JSON.parse(storedPermissions));
    if (storedBranches) setBranches(JSON.parse(storedBranches));
    if (storedIsAdmin) setIsPrimaryAdmin(JSON.parse(storedIsAdmin));
    let bizIdFromCache: string | undefined;
    if (storedBusiness) {
      try {
        bizIdFromCache = JSON.parse(storedBusiness)?.id;
      } catch {
        /* ignore */
      }
    }
    let rawTheme: string | null = null;
    if (bizIdFromCache) {
      rawTheme = localStorage.getItem(portalThemeStorageKey(bizIdFromCache));
    } else {
      rawTheme = localStorage.getItem(PORTAL_THEME_LEGACY_KEY);
    }
    if (rawTheme) {
      try {
        const o = JSON.parse(rawTheme) as unknown;
        if (o && typeof o === 'object' && 'primary_hex' in (o as object)) {
          setPortalTheme(mergePortalTheme(o));
        }
      } catch {
        /* ignore */
      }
    }
    if (storedUser) {
      markLocalSessionCookie(true);
    }
  };

  const clearLocalState = () => {
    setUser(null);
    setBusiness(null);
    setBranch(null);
    setBranches([]);
    setActiveBranchCount(0);
    setPermissions({});
    setIsPrimaryAdmin(false);
    setSubscription(null);
    setPortalTheme(null);
    localStorage.removeItem('user');
    localStorage.removeItem('businessId');
    clearAllBranchStorage();
    localStorage.removeItem('business');
    localStorage.removeItem('branch');
    localStorage.removeItem('branches');
    localStorage.removeItem('permissions');
    localStorage.removeItem('isPrimaryAdmin');
    removeAllPortalThemeStorageKeys();
    markLocalSessionCookie(false);
  };

  const restoreCachedSession = useCallback((): boolean => {
    const storedUser = localStorage.getItem('user');
    if (!storedUser) return false;
    loadFromCache();
    markLocalSessionCookie(true);
    setLoading(false);
    return true;
  }, []);

  /** After /api/auth/session returns 401 (orphan tenant, deleted user, etc.) */
  const redirectToLoginAfterSessionFailure = useCallback(
    async (res: Response, generationAtStart: number) => {
      if (generationAtStart !== sessionGenerationRef.current) {
        return;
      }
      if (shouldTrustCachedSession()) {
        restoreCachedSession();
        return;
      }
      let reason = 'session_invalid';
      try {
        const body = await res.json();
        if (body?.code === 'BUSINESS_NOT_FOUND') reason = 'business_deleted';
        else if (body?.code === 'USER_NOT_FOUND') reason = 'user_deleted';
      } catch {
        /* ignore */
      }
      clearLocalState();
      try {
        await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
      } catch {
        /* non-blocking */
      }
      try {
        const { clearAllCapabilitySnapshots } = await import('@/lib/capability-snapshot');
        clearAllCapabilitySnapshots();
      } catch {
        /* ignore */
      }

      const p = pathname || '';

      // Do not hijack sign-up / marketing: stale JWT + 401 used to always send users to /login,
      // so they could not complete /signup after a deleted-business incident.
      const stayOnPublicSurface =
        p === '/' ||
        p.startsWith('/signup') ||
        p.startsWith('/book-demo') ||
        p.startsWith('/terms') ||
        p.startsWith('/privacy') ||
        p.startsWith('/admin/login') ||
        p.startsWith('/attendance/login') ||
        p.startsWith('/attendance/kiosk');

      if (stayOnPublicSurface) {
        const base = p.split('?')[0] || '/';
        router.replace(base);
        return;
      }

      if (p.startsWith('/login')) {
        router.replace(`/login?reason=${reason}`);
        return;
      }

      const redirect = encodeURIComponent(p || '/dashboard');
      router.replace(`/login?reason=${reason}&redirect=${redirect}`);
    },
    [router, pathname, restoreCachedSession]
  );

  /**
   * Fetch session data from the server.
   * The JWT cookie is sent automatically by the browser.
   * The server reads userId from the cookie, not from query params.
   */
  const fetchSession = async (): Promise<boolean> => {
    const generationAtStart = sessionGenerationRef.current;
    try {
      const res = await fetch('/api/auth/session', { credentials: 'same-origin' });
      if (generationAtStart !== sessionGenerationRef.current) {
        return false;
      }
      if (res.ok) {
        const data = await res.json();
        setUser(data.user);
        setBusiness(data.business);
        setBranch(data.branch || null);
        setBranches(data.branches || []);
        setActiveBranchCount(
          typeof data.activeBranchCount === 'number'
            ? data.activeBranchCount
            : (data.branches?.length ?? 0)
        );
        setPermissions(data.permissions || {});
        setIsPrimaryAdmin(data.isPrimaryAdmin || false);
        setSubscription(data.subscription || null);
        if (data.portalTheme && data.user?.business_id) {
          setPortalTheme(data.portalTheme);
          persistPortalThemeFromSession(data.portalTheme, data.user.business_id);
        } else {
          setPortalTheme(null);
          removeAllPortalThemeStorageKeys();
        }

        if (data.user) localStorage.setItem('user', JSON.stringify(data.user));
        if (data.business) {
          localStorage.setItem('business', JSON.stringify(data.business));
          localStorage.setItem('businessId', data.business.id);
        } else if (data.user?.business_id) {
          localStorage.setItem('businessId', data.user.business_id);
        }
        if (data.branch) localStorage.setItem('branch', JSON.stringify(data.branch));
        if (data.permissions) localStorage.setItem('permissions', JSON.stringify(data.permissions));
        if (data.branches) localStorage.setItem('branches', JSON.stringify(data.branches));
        localStorage.setItem('isPrimaryAdmin', JSON.stringify(data.isPrimaryAdmin || false));
        return true;
      } else if (res.status === 401 || res.status === 404) {
        if (shouldTrustCachedSession()) {
          loadFromCache();
          return false;
        }
        // Expired JWT while app shell still has cached user — keep offline navigation working.
        if (localStorage.getItem('user')) {
          let hardLogout = false;
          try {
            const body = await res.clone().json();
            hardLogout =
              body?.code === 'BUSINESS_NOT_FOUND' || body?.code === 'USER_NOT_FOUND';
          } catch {
            loadFromCache();
            return false;
          }
          if (!hardLogout) {
            loadFromCache();
            return false;
          }
        }
        await redirectToLoginAfterSessionFailure(res, generationAtStart);
        return false;
      } else {
        // Server error - use cached data as fallback
        loadFromCache();
        return false;
      }
    } catch (err) {
      if (generationAtStart !== sessionGenerationRef.current) {
        return false;
      }
      console.warn('[AuthContext] Failed to fetch session (using cached):', err);
      loadFromCache();
      return false;
    } finally {
      if (generationAtStart === sessionGenerationRef.current) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    if (!pathname) return;
    if (isCapacitorNative() && !networkReady) return;
    if (authBootstrappedRef.current) return;
    authBootstrappedRef.current = true;

    const initAuth = async () => {
      const storedUser = localStorage.getItem('user');

      if (storedUser) {
        // Show cached data immediately while fetching fresh session
        loadFromCache();
        if (shouldTrustCachedSession()) {
          // Do not hit /api/auth/session while offline — stale JWT must not logout.
          setLoading(false);
          return;
        }
        await fetchSession();
      } else {
        // No cached user - try fetching session (cookie may still be valid)
        const generationAtStart = sessionGenerationRef.current;
        try {
          const res = await fetch('/api/auth/session', { credentials: 'same-origin' });
          if (generationAtStart !== sessionGenerationRef.current) {
            return;
          }
          if (res.ok) {
            const data = await res.json();
            if (data.user) {
              setUser(data.user);
              setBusiness(data.business);
              setBranch(data.branch || null);
              setBranches(data.branches || []);
              setActiveBranchCount(
                typeof data.activeBranchCount === 'number'
                  ? data.activeBranchCount
                  : (data.branches?.length ?? 0)
              );
              setPermissions(data.permissions || {});
              setIsPrimaryAdmin(data.isPrimaryAdmin || false);
              setSubscription(data.subscription || null);
              if (data.portalTheme && data.user?.business_id) {
                setPortalTheme(data.portalTheme);
                persistPortalThemeFromSession(data.portalTheme, data.user.business_id);
              } else {
                setPortalTheme(null);
                removeAllPortalThemeStorageKeys();
              }

              localStorage.setItem('user', JSON.stringify(data.user));
              if (data.business) {
                localStorage.setItem('business', JSON.stringify(data.business));
                localStorage.setItem('businessId', data.business.id);
              } else if (data.user?.business_id) {
                localStorage.setItem('businessId', data.user.business_id);
              }
              if (data.branch) localStorage.setItem('branch', JSON.stringify(data.branch));
              if (data.permissions) localStorage.setItem('permissions', JSON.stringify(data.permissions));
              if (data.branches) localStorage.setItem('branches', JSON.stringify(data.branches));
              localStorage.setItem('isPrimaryAdmin', JSON.stringify(data.isPrimaryAdmin || false));
              setLoading(false);
              return;
            }
          } else if (res.status === 401 || res.status === 404) {
            if (shouldTrustCachedSession()) {
              setLoading(false);
              return;
            }
            const generationAtStart = sessionGenerationRef.current;
            await redirectToLoginAfterSessionFailure(res, generationAtStart);
            if (generationAtStart === sessionGenerationRef.current) {
              setLoading(false);
            }
            return;
          }
        } catch {
          // Network error without cached user — stay on page (offline bootstrap may still load shell)
        }

        setLoading(false);
        const isOffline = shouldTrustCachedSession();
        const isPublicPage =
          pathname === '/' ||
          pathname.startsWith('/login') ||
          pathname.startsWith('/signup') ||
          pathname.startsWith('/book-demo') ||
          pathname.startsWith('/admin') ||
          pathname.startsWith('/attendance') ||
          pathname === '/offline';
        if (!isPublicPage && !isOffline) router.push('/login');
      }
    };

    initAuth();
  }, [pathname, router, networkReady]);

  useEffect(() => {
    if (user) return;
    if (typeof window !== 'undefined' && localStorage.getItem('user')) return;
    authBootstrappedRef.current = false;
  }, [user]);

  useEffect(() => {
    const onReconnect = () => {
      if (localStorage.getItem('user')) {
        void fetchSession();
      }
    };
    window.addEventListener(NETWORK_RECONNECT_EVENT, onReconnect);
    return () => window.removeEventListener(NETWORK_RECONNECT_EVENT, onReconnect);
  }, []);

  const login = async (data: any) => {
    // Invalidate any in-flight session check (e.g. initAuth with a stale cookie).
    sessionGenerationRef.current += 1;
    const loginGeneration = sessionGenerationRef.current;

    // The server already set the JWT cookie in the response.
    // We just store user data in state + localStorage for UI rendering.
    setUser(data.user);
    if (data.business) setBusiness(data.business);
    if (data.branch) setBranch(data.branch);

    localStorage.setItem('user', JSON.stringify(data.user));
    localStorage.setItem('businessId', data.user.business_id);
    if (data.business) localStorage.setItem('business', JSON.stringify(data.business));
    if (data.branch) localStorage.setItem('branch', JSON.stringify(data.branch));

    // Ensure the browser has applied Set-Cookie from the login POST before the next API call.
    await router.refresh();

    // Fetch full session data (permissions, branches, subscription)
    const sessionOk = await fetchSession();
    if (loginGeneration !== sessionGenerationRef.current) {
      return;
    }
    if (!sessionOk) {
      return;
    }

    router.push('/dashboard');
  };

  const logout = async () => {
    sessionGenerationRef.current += 1;
    try {
      // Clear server-side session cookie
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
    } catch {
      // Non-blocking
    }

    try {
      const { clearAllCapabilitySnapshots } = await import('@/lib/capability-snapshot');
      clearAllCapabilitySnapshots();
    } catch {
      // Non-blocking
    }

    try {
      const { clearAllDashboardSnapshots } = await import('@/lib/dashboard-snapshot');
      clearAllDashboardSnapshots();
    } catch {
      // Non-blocking
    }

    try {
      const { clearOfflineTenantData } = await import(
        '@/lib/offline/migration/migrate-local-storage'
      );
      if (business?.id && user?.id) {
        await clearOfflineTenantData({
          businessId: business.id,
          userId: user.id,
        });
      }
    } catch {
      // Non-blocking
    }

    clearLocalState();
    router.push('/login');
  };

  const refresh = useCallback(async () => {
    if (user && !shouldTrustCachedSession()) await fetchSession();
  }, [user?.id]);

  const value = useMemo(() => ({
    user,
    business,
    branch,
    branches,
    activeBranchCount,
    permissions,
    isPrimaryAdmin,
    subscription,
    portalTheme,
    loading,
    login,
    logout,
    refresh,
    restoreCachedSession,
  }), [user, business, branch, branches, activeBranchCount, permissions, isPrimaryAdmin, subscription, portalTheme, loading, refresh, restoreCachedSession]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}
