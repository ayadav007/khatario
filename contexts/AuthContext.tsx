'use client';

import { useRenderLoopProbe } from '@/lib/debug/render-loop-detector';

import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { User, Business } from '@/types/database';
import { clearAllBranchStorage } from '@/lib/branch-storage';
import { mergePortalTheme, type PortalTheme } from '@/lib/portal-theme';
import {
  persistPortalThemeToClientStorage,
  readCachedPortalThemeFromClientStorage,
  removeAllPortalThemeClientStorage,
} from '@/lib/portal-theme-storage';
import { markLocalSessionCookie } from '@/lib/auth/local-session-cookie';
import { isPublicMarketingSurface } from '@/lib/auth/public-surfaces';
import { shouldTrustCachedSession } from '@/lib/auth/should-trust-cached-session';
import { NETWORK_RECONNECT_EVENT } from '@/lib/network/events';
import { useNetworkStatusContext } from '@/contexts/NetworkStatusContext';
import { isCapacitorNative } from '@/lib/capacitor/platform';
import {
  deriveModulesFromProductLine,
  getDefaultHomePath,
  type PlatformModule,
} from '@/lib/platform-modules';
import type { BusinessPlatformContext } from '@/lib/business-modules';

/** Legacy unscoped key — migrated away on successful session fetch to prevent cross-business bleed. */
const PORTAL_THEME_LEGACY_KEY = 'portalTheme';

function portalThemeStorageKey(businessId: string): string {
  return `${PORTAL_THEME_LEGACY_KEY}:${businessId}`;
}

function persistPortalThemeFromSession(portalTheme: PortalTheme, businessId: string): void {
  persistPortalThemeToClientStorage(portalTheme, businessId);
}

/** Avoid Auth → Sidebar re-render storms when /api/auth/session returns fresh object literals. */
function sessionUserUnchanged(prev: User | null, next: User | null): boolean {
  if (prev === next) return true;
  if (!prev || !next) return false;
  return prev.id === next.id && prev.business_id === next.business_id;
}

function sessionBusinessUnchanged(prev: Business | null, next: Business | null): boolean {
  if (prev === next) return true;
  if (!prev || !next) return false;
  return prev.id === next.id && prev.name === next.name;
}

function sessionBranchUnchanged(prev: unknown, next: unknown): boolean {
  if (prev === next) return true;
  if (!prev || !next) return false;
  const a = prev as { id?: string; name?: string; branch_code?: string };
  const b = next as { id?: string; name?: string; branch_code?: string };
  return a.id === b.id && a.name === b.name && a.branch_code === b.branch_code;
}

function sessionBranchesUnchanged(prev: unknown[], next: unknown[]): boolean {
  if (prev === next) return true;
  if (prev.length !== next.length) return false;
  for (let i = 0; i < prev.length; i++) {
    const a = prev[i] as { id?: string };
    const b = next[i] as { id?: string };
    if (a?.id !== b?.id) return false;
  }
  return true;
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
  /** Enabled platform modules + default home route from session. */
  platformSession: BusinessPlatformContext | null;
  hasPlatformModule: (moduleKey: PlatformModule) => boolean;
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
  platformSession: null,
  hasPlatformModule: () => false,
  portalTheme: null,
  loading: true,
  login: async () => {},
  logout: () => {},
  refresh: async () => {},
  restoreCachedSession: () => false,
});

const PLATFORM_SESSION_STORAGE_KEY = 'platformSession';

function derivePlatformSessionFromBusiness(business: Business | null): BusinessPlatformContext {
  const derived = deriveModulesFromProductLine(business?.product_line);
  const primary =
    business?.primary_module && derived.enabled.includes(business.primary_module as PlatformModule)
      ? (business.primary_module as PlatformModule)
      : derived.primary;
  return {
    enabledModules: derived.enabled,
    primaryModule: primary,
    defaultHomePath: getDefaultHomePath({
      enabledModules: derived.enabled,
      primaryModule: primary,
    }),
  };
}

function parsePlatformSession(raw: unknown): BusinessPlatformContext | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as BusinessPlatformContext;
  if (!Array.isArray(o.enabledModules) || !o.primaryModule || !o.defaultHomePath) return null;
  return o;
}

export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  useRenderLoopProbe('AuthProvider');
  const { networkReady } = useNetworkStatusContext();
  const [user, setUser] = useState<User | null>(null);
  const [business, setBusiness] = useState<Business | null>(null);
  const [branch, setBranch] = useState<any | null>(null);
  const [branches, setBranches] = useState<any[]>([]);
  const [activeBranchCount, setActiveBranchCount] = useState(0);
  const [permissions, setPermissions] = useState<SessionPermissions>({});
  const [isPrimaryAdmin, setIsPrimaryAdmin] = useState(false);
  const [subscription, setSubscription] = useState<any | null>(null);
  const [platformSession, setPlatformSession] = useState<BusinessPlatformContext | null>(null);
  const [portalTheme, setPortalTheme] = useState<PortalTheme | null>(() =>
    readCachedPortalThemeFromClientStorage()
  );
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const pathname = usePathname();
  /** Bumped on login/logout so stale in-flight /api/auth/session calls cannot revoke a new session. */
  const sessionGenerationRef = useRef(0);
  const authBootstrappedRef = useRef(false);
  const authWasPublicSurfaceRef = useRef<boolean | null>(null);
  const reconnectFetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    if (storedUser) {
      const parsedUser = JSON.parse(storedUser) as User;
      setUser((prev) => (sessionUserUnchanged(prev, parsedUser) ? prev : parsedUser));
    }
    if (storedBusiness) {
      const b = JSON.parse(storedBusiness) as Business;
      setBusiness((prev) => (sessionBusinessUnchanged(prev, b) ? prev : b));
      if (b?.id) {
        try {
          localStorage.setItem('businessId', b.id);
        } catch {
          /* ignore */
        }
      }
    }
    if (storedBranch) {
      const parsedBranch = JSON.parse(storedBranch);
      setBranch((prev: typeof branch) =>
        sessionBranchUnchanged(prev, parsedBranch) ? prev : parsedBranch
      );
    }
    if (storedPermissions) {
      const parsed = JSON.parse(storedPermissions) as SessionPermissions;
      setPermissions((prev) => {
        if (JSON.stringify(prev) === JSON.stringify(parsed)) return prev;
        return parsed;
      });
    }
    if (storedBranches) {
      const parsedBranches = JSON.parse(storedBranches) as unknown[];
      setBranches((prev: typeof branches) =>
        sessionBranchesUnchanged(prev, parsedBranches) ? prev : parsedBranches
      );
    }
    if (storedIsAdmin) {
      const parsedAdmin = JSON.parse(storedIsAdmin) as boolean;
      setIsPrimaryAdmin((prev) => (prev === parsedAdmin ? prev : parsedAdmin));
    }
    const storedPlatform = localStorage.getItem(PLATFORM_SESSION_STORAGE_KEY);
    if (storedPlatform) {
      const parsedPlatform = parsePlatformSession(JSON.parse(storedPlatform));
      if (parsedPlatform) {
        setPlatformSession((prev) =>
          prev && JSON.stringify(prev) === JSON.stringify(parsedPlatform) ? prev : parsedPlatform,
        );
      }
    } else if (storedBusiness) {
      try {
        const b = JSON.parse(storedBusiness) as Business;
        setPlatformSession((prev) => {
          const next = derivePlatformSessionFromBusiness(b);
          return prev && JSON.stringify(prev) === JSON.stringify(next) ? prev : next;
        });
      } catch {
        /* ignore */
      }
    }
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
          const merged = mergePortalTheme(o);
          setPortalTheme((prev) => {
            if (prev && JSON.stringify(prev) === JSON.stringify(merged)) return prev;
            return merged;
          });
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
    setPlatformSession(null);
    setPortalTheme(null);
    localStorage.removeItem('user');
    localStorage.removeItem('businessId');
    clearAllBranchStorage();
    localStorage.removeItem('business');
    localStorage.removeItem('branch');
    localStorage.removeItem('branches');
    localStorage.removeItem('permissions');
    localStorage.removeItem('isPrimaryAdmin');
    localStorage.removeItem(PLATFORM_SESSION_STORAGE_KEY);
    removeAllPortalThemeClientStorage();
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
      const stayOnPublicSurface = isPublicMarketingSurface(p);

      if (stayOnPublicSurface) {
        const base = p.split('?')[0] || '/';
        router.replace(base);
        return;
      }

      if (p.startsWith('/login')) {
        // Already on the login page — never self-navigate. router.replace to the
        // same route remounts the form (clearing typed input) and can produce a
        // refresh loop on native WebViews. Logged-out state is already applied.
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
        setUser((prev) =>
          sessionUserUnchanged(prev, data.user) ? prev : data.user
        );
        setBusiness((prev) =>
          sessionBusinessUnchanged(prev, data.business) ? prev : data.business
        );
        setBranch((prev: typeof branch) => {
          const next = data.branch || null;
          return sessionBranchUnchanged(prev, next) ? prev : next;
        });
        setBranches((prev: typeof branches) => {
          const next = data.branches || [];
          return sessionBranchesUnchanged(prev, next) ? prev : next;
        });
        setActiveBranchCount((prev) => {
          const next =
            typeof data.activeBranchCount === 'number'
              ? data.activeBranchCount
              : (data.branches?.length ?? 0);
          return prev === next ? prev : next;
        });
        setPermissions((prev) => {
          const next = data.permissions || {};
          if (JSON.stringify(prev) === JSON.stringify(next)) return prev;
          return next;
        });
        setIsPrimaryAdmin((prev) => {
          const next = data.isPrimaryAdmin || false;
          return prev === next ? prev : next;
        });
        setSubscription((prev: typeof subscription) => {
          const next = data.subscription || null;
          if (prev === next) return prev;
          if (prev && next && JSON.stringify(prev) === JSON.stringify(next)) return prev;
          return next;
        });
        if (data.portalTheme && data.user?.business_id) {
          setPortalTheme((prev) => {
            if (prev && JSON.stringify(prev) === JSON.stringify(data.portalTheme)) return prev;
            return data.portalTheme;
          });
          persistPortalThemeFromSession(data.portalTheme, data.user.business_id);
        } else {
          setPortalTheme((prev) => (prev === null ? prev : null));
          removeAllPortalThemeClientStorage();
        }

        const nextPlatform =
          parsePlatformSession(data.platform) ??
          derivePlatformSessionFromBusiness(data.business ?? null);
        setPlatformSession((prev) =>
          prev && JSON.stringify(prev) === JSON.stringify(nextPlatform) ? prev : nextPlatform,
        );
        localStorage.setItem(PLATFORM_SESSION_STORAGE_KEY, JSON.stringify(nextPlatform));

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

        const onPublicSurface = isPublicMarketingSurface(pathname || '');

        if (localStorage.getItem('user')) {
          let hardLogout = false;
          try {
            const body = await res.clone().json();
            hardLogout =
              body?.code === 'BUSINESS_NOT_FOUND' ||
              body?.code === 'USER_NOT_FOUND' ||
              body?.code === 'SESSION_REVOKED';
          } catch {
            if (onPublicSurface) {
              clearLocalState();
              return false;
            }
            loadFromCache();
            return false;
          }
          if (hardLogout) {
            await redirectToLoginAfterSessionFailure(res, generationAtStart);
            return false;
          }
          if (onPublicSurface) {
            clearLocalState();
            return false;
          }
          loadFromCache();
          return false;
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

    const onPublicSurface = isPublicMarketingSurface(pathname);
    const wasPublicSurface = authWasPublicSurfaceRef.current;
    authWasPublicSurfaceRef.current = onPublicSurface;
    if (wasPublicSurface === true && !onPublicSurface) {
      authBootstrappedRef.current = false;
    }

    if (authBootstrappedRef.current) return;
    authBootstrappedRef.current = true;

    const initAuth = async () => {
      const storedUser = localStorage.getItem('user');
      const onPublicSurface = isPublicMarketingSurface(pathname || '');

      if (storedUser) {
        if (!onPublicSurface) {
          loadFromCache();
        }
        if (shouldTrustCachedSession()) {
          if (!onPublicSurface) {
            loadFromCache();
          }
          setLoading(false);
          return;
        }
        if (onPublicSurface) {
          // Stale local shell on marketing pages — clear quietly (no /api/auth/session 401 in console).
          // A valid httpOnly session is restored when the user opens an app route.
          clearLocalState();
          authBootstrappedRef.current = false;
          setLoading(false);
          return;
        }
        await fetchSession();
      } else {
        if (onPublicSurface) {
          setLoading(false);
          return;
        }
        // No cached user — cookie may still be valid (e.g. cleared localStorage).
        const generationAtStart = sessionGenerationRef.current;
        try {
          const res = await fetch('/api/auth/session', { credentials: 'same-origin' });
          if (generationAtStart !== sessionGenerationRef.current) {
            return;
          }
          if (res.ok) {
            const data = await res.json();
            if (data.user) {
              setUser((prev) =>
                sessionUserUnchanged(prev, data.user) ? prev : data.user
              );
              setBusiness((prev) =>
                sessionBusinessUnchanged(prev, data.business) ? prev : data.business
              );
              setBranch((prev: typeof branch) => {
                const next = data.branch || null;
                return sessionBranchUnchanged(prev, next) ? prev : next;
              });
              setBranches((prev: typeof branches) => {
                const next = data.branches || [];
                return sessionBranchesUnchanged(prev, next) ? prev : next;
              });
              setActiveBranchCount((prev) => {
                const next =
                  typeof data.activeBranchCount === 'number'
                    ? data.activeBranchCount
                    : (data.branches?.length ?? 0);
                return prev === next ? prev : next;
              });
              setPermissions((prev) => {
                const next = data.permissions || {};
                if (JSON.stringify(prev) === JSON.stringify(next)) return prev;
                return next;
              });
              setIsPrimaryAdmin((prev) => {
                const next = data.isPrimaryAdmin || false;
                return prev === next ? prev : next;
              });
              setSubscription((prev: typeof subscription) => {
                const next = data.subscription || null;
                if (prev === next) return prev;
                if (prev && next && JSON.stringify(prev) === JSON.stringify(next)) return prev;
                return next;
              });
              if (data.portalTheme && data.user?.business_id) {
                setPortalTheme((prev) => {
                  if (prev && JSON.stringify(prev) === JSON.stringify(data.portalTheme)) return prev;
                  return data.portalTheme;
                });
                persistPortalThemeFromSession(data.portalTheme, data.user.business_id);
              } else {
                setPortalTheme((prev) => (prev === null ? prev : null));
                removeAllPortalThemeClientStorage();
              }

              const nextPlatform =
                parsePlatformSession(data.platform) ??
                derivePlatformSessionFromBusiness(data.business ?? null);
              setPlatformSession((prev) =>
                prev && JSON.stringify(prev) === JSON.stringify(nextPlatform) ? prev : nextPlatform,
              );
              localStorage.setItem(PLATFORM_SESSION_STORAGE_KEY, JSON.stringify(nextPlatform));

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
            const p = pathname || '';
            const isPublicPage =
              p === '/' ||
              p.startsWith('/login') ||
              p.startsWith('/signup') ||
              p.startsWith('/book-demo') ||
              p.startsWith('/admin') ||
              p.startsWith('/attendance') ||
              p === '/offline';

            // No cached user on a public page is the normal logged-out state.
            // Redirecting /login -> /login?reason=... causes a navigation loop
            // that remounts the form and clears typed phone numbers.
            if (isPublicPage) {
              setLoading(false);
              return;
            }
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
        if (!isPublicPage && !isOffline) router.replace('/login');
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
      if (!localStorage.getItem('user')) return;
      if (reconnectFetchTimerRef.current) {
        clearTimeout(reconnectFetchTimerRef.current);
      }
      reconnectFetchTimerRef.current = setTimeout(() => {
        reconnectFetchTimerRef.current = null;
        void fetchSession();
      }, 1500);
    };
    window.addEventListener(NETWORK_RECONNECT_EVENT, onReconnect);
    return () => {
      if (reconnectFetchTimerRef.current) {
        clearTimeout(reconnectFetchTimerRef.current);
      }
      window.removeEventListener(NETWORK_RECONNECT_EVENT, onReconnect);
    };
  }, []);

  const login = async (data: any) => {
    // Invalidate any in-flight session check (e.g. initAuth with a stale cookie).
    sessionGenerationRef.current += 1;
    authBootstrappedRef.current = true;

    // The server already set the JWT cookie in the login POST response.
    setUser(data.user);
    if (data.business) setBusiness(data.business);
    if (data.branch) setBranch(data.branch);

    const nextPlatform =
      parsePlatformSession(data.platform) ??
      derivePlatformSessionFromBusiness(data.business ?? null);
    setPlatformSession(nextPlatform);

    localStorage.setItem('user', JSON.stringify(data.user));
    localStorage.setItem('businessId', data.user.business_id);
    if (data.business) localStorage.setItem('business', JSON.stringify(data.business));
    if (data.branch) localStorage.setItem('branch', JSON.stringify(data.branch));
    localStorage.setItem(PLATFORM_SESSION_STORAGE_KEY, JSON.stringify(nextPlatform));
    markLocalSessionCookie(true);
    setLoading(false);

    // Full navigation — router.replace() after async fetchSession often leaves the
    // login page mounted (web + Capacitor). Dashboard initAuth hydrates the session.
    window.location.replace(nextPlatform.defaultHomePath);
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
    router.replace('/login');
  };

  const refresh = useCallback(async () => {
    if (user && !shouldTrustCachedSession()) await fetchSession();
  }, [user?.id]);

  const hasPlatformModule = useCallback(
    (moduleKey: PlatformModule) =>
      platformSession?.enabledModules.includes(moduleKey) ?? false,
    [platformSession],
  );

  const value = useMemo(() => ({
    user,
    business,
    branch,
    branches,
    activeBranchCount,
    permissions,
    isPrimaryAdmin,
    subscription,
    platformSession,
    hasPlatformModule,
    portalTheme,
    loading,
    login,
    logout,
    refresh,
    restoreCachedSession,
  }), [user, business, branch, branches, activeBranchCount, permissions, isPrimaryAdmin, subscription, platformSession, hasPlatformModule, portalTheme, loading, refresh, restoreCachedSession]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}
