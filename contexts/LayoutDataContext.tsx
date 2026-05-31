'use client';

import { useRenderLoopProbe } from '@/lib/debug/render-loop-detector';

import React, { createContext, useContext, useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useAuth } from './AuthContext';
import {
  saveCapabilitySnapshot,
  loadCapabilitySnapshot,
  isSnapshotExpired,
  type CapabilitySnapshot,
  type Subscription,
  type Addon,
} from '@/lib/capability-snapshot';
import { useNetworkStatus } from '@/hooks/useNetworkStatus';
import { markAppSynced } from '@/lib/sync-timestamp';
import {
  fetchWithDedup,
  getCacheKey,
  invalidateCacheKey,
  clearLayoutFetchCache,
} from '@/lib/layout-data/fetch-cache';
import { NotificationProvider } from './NotificationContext';
import { BadgeProvider } from './BadgeContext';

export interface Promotion {
  id: string;
  title: string;
  description?: string;
  image_url?: string;
  button_text?: string;
  button_url?: string;
  button_action?: 'link' | 'upgrade_modal' | 'route';
  background_color: string;
  text_color: string;
  dismissible: boolean;
  message_type: 'banner' | 'sidebar' | 'modal' | 'topbar' | 'carousel';
  [key: string]: unknown;
}

interface LayoutData {
  subscription: Subscription | null;
  addons: Addon[];
  enabledFeatureIds: string[];
  promotions: {
    banner: Promotion | null;
    sidebar: Promotion | null;
    modal: Promotion | null;
    topbar: Promotion | null;
  };
  warehousesEnabled: boolean;
  warehousesSettingLoaded: boolean;
}

interface LayoutDataContextType extends LayoutData {
  loading: boolean;
  snapshotLoaded: boolean;
  refreshSubscription: () => Promise<void>;
  refreshPromotion: (type: 'banner' | 'sidebar' | 'modal' | 'topbar') => Promise<Promotion | null>;
  refreshWarehouses: () => Promise<void>;
}

const LayoutDataContext = createContext<LayoutDataContextType>({
  subscription: null,
  addons: [],
  enabledFeatureIds: [],
  promotions: { banner: null, sidebar: null, modal: null, topbar: null },
  warehousesEnabled: false,
  warehousesSettingLoaded: false,
  loading: true,
  snapshotLoaded: false,
  refreshSubscription: async () => {},
  refreshPromotion: async () => null,
  refreshWarehouses: async () => {},
});

interface ShellLayoutSettings {
  warehousesEnabled: boolean;
  warehousesSettingLoaded: boolean;
  snapshotLoaded: boolean;
}

const ShellLayoutSettingsContext = createContext<ShellLayoutSettings>({
  warehousesEnabled: false,
  warehousesSettingLoaded: false,
  snapshotLoaded: false,
});

function LayoutDataProviderInner({ children }: { children: React.ReactNode }) {
  useRenderLoopProbe('LayoutDataProvider');
  const { business, user } = useAuth();
  const { isOnline, lastChangedAt } = useNetworkStatus();
  const prevOnlineRef = useRef(isOnline);
  const [data, setData] = useState<LayoutData>({
    subscription: null,
    addons: [],
    enabledFeatureIds: [],
    promotions: { banner: null, sidebar: null, modal: null, topbar: null },
    warehousesEnabled: false,
    warehousesSettingLoaded: false,
  });
  const [loading, setLoading] = useState(true);
  const hasInitialized = useRef(false);

  const fetchSubscription = useCallback(async () => {
    if (!business?.id || !user?.id) return;

    try {
      const [subRes, addonsRes, featuresRes] = await Promise.all([
        fetchWithDedup<{ subscription: Subscription }>(
          '/api/subscriptions/current',
          { business_id: business.id }
        ),
        fetchWithDedup<{ addons: Addon[] }>(
          '/api/subscriptions/addons/current',
          { business_id: business.id }
        ),
        fetch(`/api/features/enabled?business_id=${business.id}`, {
          credentials: 'include',
        }),
      ]);

      const subscription = subRes.subscription || null;
      const addons = addonsRes.addons || [];
      let enabledFeatureIds: string[] = [];
      if (featuresRes.ok) {
        const f = await featuresRes.json().catch(() => ({}));
        enabledFeatureIds = f.enabledIds || [];
      }

      setData((prev) => ({
        ...prev,
        subscription,
        addons,
        enabledFeatureIds,
      }));

      const existing = loadCapabilitySnapshot(business.id, user.id);
      if (existing) {
        saveCapabilitySnapshot({
          ...existing,
          subscription,
          addons,
          enabledFeatures:
            enabledFeatureIds.length > 0
              ? enabledFeatureIds
              : (existing.enabledFeatures || []),
          timestamp: Date.now(),
        });
      }
    } catch (error) {
      console.error('Failed to fetch subscription:', error);
    }
  }, [business?.id, user?.id]);

  const fetchWarehousesSetting = useCallback(async (skipCache: boolean = false) => {
    if (!business?.id) {
      return;
    }
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setData((prev) => ({
        ...prev,
        warehousesSettingLoaded: true,
      }));
      return;
    }

    try {
      if (skipCache) {
        invalidateCacheKey(getCacheKey('/api/settings/warehouses', { business_id: business.id }));
      }

      const res = await fetchWithDedup<{ warehouses_enabled: boolean }>(
        '/api/settings/warehouses',
        { business_id: business.id }
      );

      setData((prev) => ({
        ...prev,
        warehousesEnabled: res.warehouses_enabled || false,
      }));
    } catch (error) {
      console.error('Failed to fetch warehouses setting:', error);
    } finally {
      setData((prev) => ({
        ...prev,
        warehousesSettingLoaded: true,
      }));
    }
  }, [business?.id]);

  const refreshWarehouses = useCallback(async () => {
    await fetchWarehousesSetting(true);
  }, [fetchWarehousesSetting]);

  const fetchPromotion = useCallback(
    async (type: 'banner' | 'sidebar' | 'modal' | 'topbar'): Promise<Promotion | null> => {
      if (!business?.id) return null;
      if (typeof navigator !== 'undefined' && !navigator.onLine) return null;

      try {
        const res = await fetchWithDedup<{ promotions: Promotion[] }>(
          '/api/promotions/active',
          { business_id: business.id, type }
        );

        const promo = res.promotions && res.promotions.length > 0 ? res.promotions[0] : null;

        setData((prev) => ({
          ...prev,
          promotions: {
            ...prev.promotions,
            [type]: promo,
          },
        }));
        return promo;
      } catch (error) {
        console.error(`Failed to fetch ${type} promotion:`, error);
        return null;
      }
    },
    [business?.id]
  );

  const [snapshotLoaded, setSnapshotLoaded] = useState(false);

  useEffect(() => {
    if (!business?.id || !user?.id || hasInitialized.current) return;

    hasInitialized.current = true;
    setLoading(true);
    setSnapshotLoaded(false);
    setData((prev) => ({
      ...prev,
      warehousesSettingLoaded: false,
    }));

    const bootstrapCapability = async () => {
      const cachedSnapshot = loadCapabilitySnapshot(business.id, user.id);
      const isExpired = cachedSnapshot ? isSnapshotExpired(cachedSnapshot) : true;

      if (!navigator.onLine) {
        if (cachedSnapshot) {
          console.log('[LayoutData] Offline: using cached snapshot (age:', Math.floor((Date.now() - (cachedSnapshot.timestamp || 0)) / 1000), 'seconds)');
          setData((prev) => ({
            ...prev,
            subscription: cachedSnapshot.subscription,
            addons: cachedSnapshot.addons || [],
            enabledFeatureIds: cachedSnapshot.enabledFeatures || [],
          }));
        } else {
          console.warn('[LayoutData] Offline: no cached snapshot found. User will see limited access.');
        }
        setSnapshotLoaded(true);
        setData((prev) => ({
          ...prev,
          warehousesSettingLoaded: true,
        }));
        setLoading(false);
        return;
      }

      if (cachedSnapshot && !isExpired) {
        console.log('[LayoutData] Online: using valid cache immediately, refreshing in background');
        setData((prev) => ({
          ...prev,
          subscription: cachedSnapshot.subscription,
          addons: cachedSnapshot.addons || [],
          enabledFeatureIds: cachedSnapshot.enabledFeatures || [],
        }));
        setSnapshotLoaded(true);
      }

      try {
        const [permsRes, subRes, addonsRes, featuresRes] = await Promise.allSettled([
          fetch(`/api/settings/permissions?user_id=${user.id}`, { credentials: 'include' }),
          fetchWithDedup<{ subscription: Subscription }>('/api/subscriptions/current', {
            business_id: business.id,
          }),
          fetchWithDedup<{ addons: Addon[] }>('/api/subscriptions/addons/current', {
            business_id: business.id,
          }),
          fetch(`/api/features/enabled?business_id=${business.id}`, { credentials: 'include' }),
        ]);

        const permissions: Record<string, { can_view: boolean; can_add: boolean; can_modify: boolean; can_delete: boolean; can_share: boolean }> = {};
        let isPrimaryAdmin = false;
        let subscription: Subscription | null = null;
        let addons: Addon[] = [];
        let enabledFeatures: string[] = [];

        if (permsRes.status === 'fulfilled' && permsRes.value.ok) {
          const p = await permsRes.value.json();
          Object.assign(permissions, p.permissions || {});
          isPrimaryAdmin = p.isPrimaryAdmin === true;
        }
        if (subRes.status === 'fulfilled') {
          subscription = subRes.value.subscription || null;
        }
        if (addonsRes.status === 'fulfilled') {
          addons = addonsRes.value.addons || [];
        }
        if (featuresRes.status === 'fulfilled' && featuresRes.value.ok) {
          const f = await featuresRes.value.json();
          enabledFeatures = f.enabledIds || [];
        }

        const fetchedPermissionsCount = Object.keys(permissions).length;
        const hasReliablePermissions = fetchedPermissionsCount > 0 || isPrimaryAdmin;

        const snapshot: CapabilitySnapshot = {
          businessId: business.id,
          userId: user.id,
          permissions: hasReliablePermissions
            ? permissions
            : (cachedSnapshot?.permissions || {}),
          isPrimaryAdmin: hasReliablePermissions
            ? isPrimaryAdmin
            : (cachedSnapshot?.isPrimaryAdmin || false),
          subscription: subscription ?? cachedSnapshot?.subscription ?? null,
          addons: addons.length > 0 ? addons : (cachedSnapshot?.addons || []),
          enabledFeatures: enabledFeatures.length > 0
            ? enabledFeatures
            : (cachedSnapshot?.enabledFeatures || []),
          timestamp: Date.now(),
        };
        saveCapabilitySnapshot(snapshot);
        markAppSynced();

        setData((prev) => ({
          ...prev,
          subscription,
          addons,
          enabledFeatureIds: snapshot.enabledFeatures || [],
        }));

        console.log('[LayoutData] Fresh snapshot saved', {
          fetchedPermissionsCount,
          effectivePermissionsCount: Object.keys(snapshot.permissions || {}).length,
          usedCachedPermissionsFallback: !hasReliablePermissions,
        });
      } catch (e) {
        console.error('[LayoutData] Capability fetch failed:', e);
        if (!cachedSnapshot) {
          console.error('[LayoutData] No cache available and fetch failed - user will have limited access');
        }
      } finally {
        setSnapshotLoaded(true);
      }
    };

    bootstrapCapability().then(() => {
      if (navigator.onLine) {
        void fetchWarehousesSetting().finally(() => setLoading(false));
      } else {
        setLoading(false);
      }
    });
  }, [business?.id, user?.id, fetchWarehousesSetting]);

  useEffect(() => {
    if (!business?.id || !user?.id) return;

    const wasOffline = !prevOnlineRef.current;
    prevOnlineRef.current = isOnline;

    if (!isOnline || !wasOffline) return;

    void Promise.allSettled([
      fetchSubscription(),
      fetchWarehousesSetting(true),
    ]);
  }, [
    isOnline,
    lastChangedAt,
    business?.id,
    user?.id,
    fetchSubscription,
    fetchWarehousesSetting,
  ]);

  useEffect(() => {
    if (!business?.id && !user) {
      clearLayoutFetchCache();
      hasInitialized.current = false;
      setSnapshotLoaded(false);
      setData((prev) => ({
        ...prev,
        warehousesSettingLoaded: false,
        enabledFeatureIds: [],
      }));
    }
  }, [business?.id, user]);

  const contextValue = useMemo<LayoutDataContextType>(
    () => ({
      ...data,
      loading,
      snapshotLoaded,
      refreshSubscription: fetchSubscription,
      refreshPromotion: fetchPromotion,
      refreshWarehouses,
    }),
    [
      data,
      loading,
      snapshotLoaded,
      fetchSubscription,
      fetchPromotion,
      refreshWarehouses,
    ]
  );

  const shellSettingsValue = useMemo<ShellLayoutSettings>(
    () => ({
      warehousesEnabled: data.warehousesEnabled,
      warehousesSettingLoaded: data.warehousesSettingLoaded,
      snapshotLoaded,
    }),
    [data.warehousesEnabled, data.warehousesSettingLoaded, snapshotLoaded]
  );

  return (
    <ShellLayoutSettingsContext.Provider value={shellSettingsValue}>
      <LayoutDataContext.Provider value={contextValue}>
        {children}
      </LayoutDataContext.Provider>
    </ShellLayoutSettingsContext.Provider>
  );
}

export function LayoutDataProvider({ children }: { children: React.ReactNode }) {
  return (
    <LayoutDataProviderInner>
      <NotificationProvider>
        <BadgeProvider>{children}</BadgeProvider>
      </NotificationProvider>
    </LayoutDataProviderInner>
  );
}

export const useLayoutData = () => useContext(LayoutDataContext);

/** Narrow hook for shell layout settings — isolated context so promotion/subscription updates do not rerender Sidebar. */
export function useShellLayoutSettings() {
  return useContext(ShellLayoutSettingsContext);
}
