'use client';

import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from './AuthContext';
import { TodoReminderPopup } from '@/components/notifications/TodoReminderPopup';
import {
  saveCapabilitySnapshot,
  loadCapabilitySnapshot,
  isSnapshotExpired,
  type CapabilitySnapshot,
} from '@/lib/capability-snapshot';
import { reminderPipelineLog } from '@/lib/reminder-pipeline-log';

/** Server upserts re-fire `created_at`; fetch-only fallback is gated (first list paint skipped) + `shownReminderIds`. */
const TODO_REMINDER_RECENT_AGE_MS = 10 * 60 * 1000;

interface Subscription {
  id: string;
  business_id: string;
  plan_id: string;
  status: string;
  plan_name?: string;
  plan_display_name?: string;
  features?: any;
  [key: string]: any;
}

interface Addon {
  id: string;
  business_id: string;
  addon_type: string;
  status: string;
  [key: string]: any;
}

interface Notification {
  id: string;
  type: string;
  title: string;
  message: string;
  is_read: boolean;
  created_at: string;
  [key: string]: any;
}

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
  [key: string]: any;
}

interface BadgeCounts {
  unpaid_invoices: number;
  low_stock_items: number;
}

interface LayoutData {
  subscription: Subscription | null;
  addons: Addon[];
  /** Enabled {@code platform_features.id} ids (from {@code GET /api/features/enabled}); used client-side without extra DB/API calls — e.g. print branding watermark. */
  enabledFeatureIds: string[];
  notifications: Notification[];
  unreadNotificationCount: number;
  promotions: {
    banner: Promotion | null;
    sidebar: Promotion | null;
    modal: Promotion | null;
    topbar: Promotion | null;
  };
  badgeCounts: BadgeCounts;
  warehousesEnabled: boolean;
  /** True after `/api/settings/warehouses` has been attempted (online) or skipped (offline). Sidebar waits on this so warehouse links do not pop in late. */
  warehousesSettingLoaded: boolean;
}

interface LayoutDataContextType extends LayoutData {
  loading: boolean;
  /** True when capability snapshot is loaded (from fetch or cache). Guards must wait for this. */
  snapshotLoaded: boolean;
  refreshSubscription: () => Promise<void>;
  refreshNotifications: () => Promise<void>;
  refreshBadgeCounts: () => Promise<void>;
  refreshPromotion: (type: 'banner' | 'sidebar' | 'modal' | 'topbar') => Promise<Promotion | null>;
  refreshWarehouses: () => Promise<void>;
  markNotificationAsRead: (id: string) => Promise<void>;
  markAllNotificationsAsRead: () => Promise<void>;
}

const LayoutDataContext = createContext<LayoutDataContextType>({
  subscription: null,
  addons: [],
  enabledFeatureIds: [],
  notifications: [],
  unreadNotificationCount: 0,
  promotions: { banner: null, sidebar: null, modal: null, topbar: null },
  badgeCounts: { unpaid_invoices: 0, low_stock_items: 0 },
  warehousesEnabled: false,
  warehousesSettingLoaded: false,
  loading: true,
  snapshotLoaded: false,
  refreshSubscription: async () => {},
  refreshNotifications: async () => {},
  refreshBadgeCounts: async () => {},
  refreshPromotion: async () => null,
  refreshWarehouses: async () => {},
  markNotificationAsRead: async () => {},
  markAllNotificationsAsRead: async () => {},
});

// Request deduplication: track in-flight requests
const inFlightRequests = new Map<string, Promise<any>>();

// Cache: store successful responses
const cache = new Map<string, { data: any; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function getCacheKey(endpoint: string, params?: Record<string, string>): string {
  const paramStr = params ? '?' + new URLSearchParams(params).toString() : '';
  return `${endpoint}${paramStr}`;
}

function isCacheValid(key: string): boolean {
  const cached = cache.get(key);
  if (!cached) return false;
  return Date.now() - cached.timestamp < CACHE_TTL;
}

async function fetchWithDedup<T>(
  endpoint: string,
  params?: Record<string, string>,
  options?: RequestInit
): Promise<T> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    throw new Error('Offline');
  }
  const cacheKey = getCacheKey(endpoint, params);
  
  // Check cache first
  if (isCacheValid(cacheKey)) {
    return cache.get(cacheKey)!.data as T;
  }
  
  // Check if request is already in flight
  if (inFlightRequests.has(cacheKey)) {
    return inFlightRequests.get(cacheKey)! as Promise<T>;
  }
  
  // Create new request
  const paramStr = params ? '?' + new URLSearchParams(params).toString() : '';
  const url = `${endpoint}${paramStr}`;

  const promise = fetch(url, options)
    .then(async (res) => {
      if (!res.ok) {
        const errorText = await res.text().catch(() => 'Unknown error');
        throw new Error(`Failed to fetch ${endpoint}: ${res.status} ${errorText}`);
      }
      
      // Check if response has content
      const contentType = res.headers.get('content-type');
      const text = await res.text();
      
      // If empty response, return empty object
      if (!text || text.trim() === '') {
        return {} as T;
      }
      
      // Try to parse as JSON
      try {
        const data = JSON.parse(text);
        // Cache successful response
        cache.set(cacheKey, { data, timestamp: Date.now() });
        return data;
      } catch (parseError) {
        console.error(`Failed to parse JSON from ${endpoint}:`, parseError, 'Response:', text.substring(0, 200));
        throw new Error(`Invalid JSON response from ${endpoint}`);
      }
    })
    .finally(() => {
      // Remove from in-flight after completion
      inFlightRequests.delete(cacheKey);
    });
  
  inFlightRequests.set(cacheKey, promise);
  return promise;
}

export function LayoutDataProvider({ children }: { children: React.ReactNode }) {
  const { business, user } = useAuth();
  const [data, setData] = useState<LayoutData>({
    subscription: null,
    addons: [],
    enabledFeatureIds: [],
    notifications: [],
    unreadNotificationCount: 0,
    promotions: { banner: null, sidebar: null, modal: null, topbar: null },
    badgeCounts: { unpaid_invoices: 0, low_stock_items: 0 },
    warehousesEnabled: false,
    warehousesSettingLoaded: false,
  });
  const [loading, setLoading] = useState(true);
  const hasInitialized = useRef(false);
  const [activeTodoReminders, setActiveTodoReminders] = useState<Array<{
    id: string;
    notificationId: string;
    title: string;
    message: string;
    todoId: string;
    createdAt: string;
  }>>([]);
  const shownReminderIds = useRef<Set<string>>(new Set());
  /** After the first list apply, `apply` may show fallback popups; first paint skips to avoid old unread spam. */
  const initialNotificationListCommittedRef = useRef(false);
  const lastNotificationSessionKeyRef = useRef<string>('');
  /** Only apply the newest notification fetch: an older `fetchWithDedup` can finish after a fresher skipCache fetch and overwrite with stale rows (popup + list). */
  const notificationsApplySeqRef = useRef(0);
  const sseErrorLogCountRef = useRef(0);

  // Fetch subscription and addons (also updates capability snapshot when online)
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

      // Update capability snapshot so offline state stays current
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

  // Debounce notification fetches to prevent rapid successive calls
  const fetchNotificationTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastFetchTimeRef = useRef<number>(0);
  const MIN_FETCH_INTERVAL = 10000; // Minimum 10 seconds between fetches (prevents excessive polling)
  /** Coalesce parallel force-refreshes (SSE, dual NotificationCenter mounts, visibility, etc.) into one HTTP request. */
  const notificationsSkipCacheInFlightRef = useRef<Promise<void> | null>(null);

  // Fetch notifications
  const fetchNotifications = useCallback(async (skipCache: boolean = false) => {
    if (!business?.id || !user?.id) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;

    const sessionKey = `${business.id}:${user.id}`;
    if (lastNotificationSessionKeyRef.current !== sessionKey) {
      lastNotificationSessionKeyRef.current = sessionKey;
      initialNotificationListCommittedRef.current = false;
      shownReminderIds.current = new Set();
      notificationsApplySeqRef.current = 0;
    }

    const applyNotificationResult = (normalizedNotifications: any[], unreadCount: number) => {
      const wasCommitted = initialNotificationListCommittedRef.current;
      if (!initialNotificationListCommittedRef.current) {
        initialNotificationListCommittedRef.current = true;
      }

      const rowById = new Map(
        (normalizedNotifications as any[])
          .filter((n) => n?.id && n?.type === 'todo_reminder')
          .map((n) => [n.id, n] as const)
      );

      setActiveTodoReminders((prev) => {
        if (prev.length === 0 && !wasCommitted) {
          return prev;
        }

        // Merge DB/API fields into popups opened from SSE (avoids generic text until list loads).
        let next = prev.map((r) => {
          const row = rowById.get(r.notificationId) as
            | { title?: string; message?: string; reference_id?: string; created_at?: string }
            | undefined;
          if (!row) return r;
          return {
            ...r,
            title: (row.title as string) || r.title,
            message: (row.message as string) || r.message,
            todoId: (row.reference_id as string) || r.todoId,
            createdAt: (row.created_at as string) || r.createdAt,
          };
        });

        if (wasCommitted) {
          const nowMs = Date.now();
          const fromFetch = (normalizedNotifications as any[]).filter((n) => {
            if (
              n?.type !== 'todo_reminder' ||
              n.is_read ||
              shownReminderIds.current.has(n.id) ||
              !n.created_at
            ) {
              return false;
            }
            const age = nowMs - new Date(n.created_at as string).getTime();
            return age < TODO_REMINDER_RECENT_AGE_MS && age > -120_000;
          });
          for (const n of fromFetch) {
            shownReminderIds.current.add(n.id);
          }
          const have = new Set(next.map((p) => p.notificationId));
          const toAdd = fromFetch.filter((n) => !have.has(n.id));
          if (toAdd.length > 0) {
            next = [
              ...next,
              ...toAdd.map((n: any) => ({
                id: `reminder-${n.id}`,
                notificationId: n.id,
                title: n.title || 'Reminder',
                message: n.message || n.title || 'You have a task reminder',
                todoId: n.reference_id || '',
                createdAt: n.created_at,
              })),
            ];
          }
        }
        return next;
      });

      const unreadTodoReminders = normalizedNotifications.filter(
        (n: any) => n?.type === 'todo_reminder' && !n.is_read
      );

      reminderPipelineLog('client.apply_notification_result', {
        path: 'fetch_sync_fallback',
        wasCommitted,
        totalCount: normalizedNotifications.length,
        unreadTodoReminderCount: unreadTodoReminders.length,
        shownTodoReminderCount: shownReminderIds.current.size,
      });

      setData((prev) => ({
        ...prev,
        notifications: normalizedNotifications,
        unreadNotificationCount: unreadCount,
      }));
    };
    
    // Clear any pending debounced fetch
    if (fetchNotificationTimeoutRef.current) {
      clearTimeout(fetchNotificationTimeoutRef.current);
      fetchNotificationTimeoutRef.current = null;
    }
    
    // Throttle: If last fetch was less than MIN_FETCH_INTERVAL ago, debounce it
    const now = Date.now();
    const timeSinceLastFetch = now - lastFetchTimeRef.current;
    
    if (!skipCache && timeSinceLastFetch < MIN_FETCH_INTERVAL) {
      // Debounce: Schedule fetch after minimum interval
      return new Promise<void>((resolve) => {
        fetchNotificationTimeoutRef.current = setTimeout(() => {
          lastFetchTimeRef.current = Date.now();
          fetchNotifications(skipCache).then(resolve);
        }, MIN_FETCH_INTERVAL - timeSinceLastFetch);
      });
    }

    if (skipCache && notificationsSkipCacheInFlightRef.current) {
      return notificationsSkipCacheInFlightRef.current;
    }
    
    lastFetchTimeRef.current = Date.now();

    const run = async () => {
    const applySeq = ++notificationsApplySeqRef.current;
    try {
      reminderPipelineLog('client.fetch_notifications.run', { skipCache, applySeq });
      const cacheKey = getCacheKey('/api/notifications', { business_id: business.id, user_id: user.id, limit: '20' });
      
      // Force-refresh (SSE, mark-as-read error recovery, explicit refresh): must not reuse a stale
      // in-flight request from before the new row existed — fetchWithDedup would return that promise.
      if (skipCache) {
        cache.delete(cacheKey);
        inFlightRequests.delete(cacheKey);
      }
      
      // Check cache first (unless skipped)
      if (!skipCache && isCacheValid(cacheKey)) {
        const cached = cache.get(cacheKey)!;
        const normalizedNotifications = (cached.data.notifications || []).map((n: any) => ({
          ...n,
          is_read: n.is_read !== undefined ? n.is_read : (n.read === true),
        }));

        reminderPipelineLog('client.fetch_notifications.cache_hit', {
          notificationCount: normalizedNotifications.length,
        });
        if (applySeq !== notificationsApplySeqRef.current) {
          reminderPipelineLog('client.fetch_notifications.stale_response_discarded', {
            applySeq,
            latest: notificationsApplySeqRef.current,
            reason: 'cache_hit',
          });
          return;
        }
        applyNotificationResult(
          normalizedNotifications,
          cached.data.unreadCount || cached.data.unread_count || 0
        );
        return; // Return cached data
      }
      
      // Fresh network fetch: bypass fetchWithDedup when skipCache so we always get a new HTTP response
      // (required for real-time SSE → same key was often still tied to an older in-flight GET).
      type NotificationsApiRes = {
        notifications: any[];
        unreadCount: number;
        unread_count?: number;
      };
      let res: NotificationsApiRes;
      if (skipCache) {
        const params = new URLSearchParams({
          business_id: business.id,
          user_id: user.id,
          limit: '20',
        });
        params.set('_', String(Date.now()));
        const response = await fetch(`/api/notifications?${params.toString()}`, {
          credentials: 'include',
        });
        if (!response.ok) {
          const errorText = await response.text().catch(() => 'Unknown error');
          throw new Error(`Failed to fetch /api/notifications: ${response.status} ${errorText}`);
        }
        const text = await response.text();
        if (!text || text.trim() === '') {
          res = { notifications: [], unreadCount: 0, unread_count: 0 };
        } else {
          res = JSON.parse(text) as NotificationsApiRes;
        }
      } else {
        res = await fetchWithDedup<{ notifications: any[]; unreadCount: number; unread_count?: number }>(
          '/api/notifications',
          { business_id: business.id, user_id: user.id, limit: '20' }
        );
      }
      
      // Normalize notification structure (API may return 'read', components expect 'is_read')
      const normalizedNotifications = (res.notifications || []).map((n: any) => ({
        ...n,
        is_read: n.is_read !== undefined ? n.is_read : (n.read === true),
      }));

      reminderPipelineLog('client.fetch_notifications.network_done', {
        skipCache,
        applySeq,
        notificationCount: normalizedNotifications.length,
      });
      if (applySeq !== notificationsApplySeqRef.current) {
        reminderPipelineLog('client.fetch_notifications.stale_response_discarded', {
          applySeq,
          latest: notificationsApplySeqRef.current,
          reason: 'network',
        });
        // Late `fetchWithDedup` may have just written an older payload into the shared cache — drop it.
        cache.delete(cacheKey);
        return;
      }
      if (skipCache) {
        cache.set(cacheKey, { data: res, timestamp: Date.now() });
      }
      applyNotificationResult(
        normalizedNotifications,
        res.unreadCount || res.unread_count || 0
      );
    } catch (error) {
      console.error('Failed to fetch notifications:', error);
    }
    };

    const p = run();
    if (skipCache) {
      notificationsSkipCacheInFlightRef.current = p.finally(() => {
        notificationsSkipCacheInFlightRef.current = null;
      });
      return notificationsSkipCacheInFlightRef.current;
    }
    await p;
  }, [business?.id, user?.id]);

  /** Stable reference — must not be an inline `() => fetchNotifications(true)` or every consumer `useEffect(..., [refreshNotifications])` re-runs on each LayoutData re-render and hammers `/api/notifications`. */
  const refreshNotifications = useCallback((): Promise<void> => {
    return fetchNotifications(true);
  }, [fetchNotifications]);

  // Fetch badge counts (forceRefresh bypasses the 5‑min cache so UI e.g. nav badges stay in sync after mutations)
  const fetchBadgeCounts = useCallback(async (forceRefresh = false) => {
    if (!business?.id) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;

    if (forceRefresh) {
      const cacheKey = getCacheKey('/api/badges/counts', { business_id: business.id });
      cache.delete(cacheKey);
    }

    try {
      const res = await fetchWithDedup<BadgeCounts>(
        '/api/badges/counts',
        { business_id: business.id }
      );

      setData((prev) => ({
        ...prev,
        badgeCounts: res || { unpaid_invoices: 0, low_stock_items: 0 },
      }));
    } catch (error) {
      console.error('Failed to fetch badge counts:', error);
    }
  }, [business?.id]);

  const refreshBadgeCounts = useCallback(async () => {
    await fetchBadgeCounts(true);
  }, [fetchBadgeCounts]);

  // Fetch warehouses setting
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
      // Invalidate cache if skipCache is true
      if (skipCache) {
        const cacheKey = getCacheKey('/api/settings/warehouses', { business_id: business.id });
        cache.delete(cacheKey);
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
  
  // Refresh warehouses setting (bypasses cache)
  const refreshWarehouses = useCallback(async () => {
    await fetchWarehousesSetting(true);
  }, [fetchWarehousesSetting]);

  // Fetch promotion (lazy - only when requested). Returns the promo so callers avoid stale closure over `promotions`.
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

  // Mark notification as read
  const markNotificationAsRead = useCallback(async (id: string) => {
    try {
      // Optimistically update UI first
      setData((prev) => ({
        ...prev,
        notifications: prev.notifications.map((n) =>
          n.id === id ? { ...n, is_read: true, read_at: new Date().toISOString() } : n
        ),
        unreadNotificationCount: Math.max(0, prev.unreadNotificationCount - 1),
      }));

      const response = await fetch(`/api/notifications/${id}/read`, { method: 'PATCH' });
      
      if (!response.ok) {
        const errorData = await response.json();
        console.error('Failed to mark notification as read:', errorData);
        // Revert optimistic update on error - only refresh if there's an error
        await fetchNotifications(true);
        return;
      }

      // Don't refresh on success - optimistic update is sufficient
      // This prevents unnecessary API calls
    } catch (error) {
      console.error('Failed to mark notification as read:', error);
      // Revert optimistic update on error - only refresh if there's an error
      await fetchNotifications(true);
    }
  }, [fetchNotifications]);

  // Mark all notifications as read
  const markAllNotificationsAsRead = useCallback(async () => {
    if (!business?.id || !user?.id) return;
    
    try {
      // Optimistically update UI first
      setData((prev) => ({
        ...prev,
        notifications: prev.notifications.map((n) => ({ ...n, is_read: true, read_at: new Date().toISOString() })),
        unreadNotificationCount: 0,
      }));

      const response = await fetch('/api/notifications/read-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ business_id: business.id, user_id: user.id }),
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        console.error('Failed to mark all notifications as read:', errorData);
        // Revert optimistic update on error - only refresh if there's an error
        await fetchNotifications(true);
        return;
      }

      // Don't refresh on success - optimistic update is sufficient
      // This prevents unnecessary API calls
    } catch (error) {
      console.error('Failed to mark all notifications as read:', error);
      // Revert optimistic update on error - only refresh if there's an error
      await fetchNotifications(true);
    }
  }, [business?.id, user?.id, fetchNotifications]);

  // Capability snapshot state (permissions, subscription, addons, features)
  const [snapshotLoaded, setSnapshotLoaded] = useState(false);

  // Bootstrap: capability snapshot first (offline or online), then rest
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
      // Always try to load from cache first (even if online)
      const cachedSnapshot = loadCapabilitySnapshot(business.id, user.id);
      const isExpired = cachedSnapshot ? isSnapshotExpired(cachedSnapshot) : true;

      // If offline, use cache (even if expired - stale data better than no data)
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

      // ONLINE: Use cache immediately if valid, then refresh in background
      if (cachedSnapshot && !isExpired) {
        console.log('[LayoutData] Online: using valid cache immediately, refreshing in background');
        setData((prev) => ({
          ...prev,
          subscription: cachedSnapshot.subscription,
          addons: cachedSnapshot.addons || [],
          enabledFeatureIds: cachedSnapshot.enabledFeatures || [],
        }));
        setSnapshotLoaded(true); // Allow UI to render immediately
      }

      // Fetch fresh data from server
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

        // Never destructively overwrite a good cached snapshot with partial/empty online data.
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
        // Already using cache if available (set above), so no additional fallback needed
        if (!cachedSnapshot) {
          console.error('[LayoutData] No cache available and fetch failed - user will have limited access');
        }
      } finally {
        setSnapshotLoaded(true);
      }
    };

    bootstrapCapability().then(() => {
      // After capability is loaded, fetch rest (only when online)
      // Subscription/addons already set by bootstrapCapability
      if (navigator.onLine) {
        Promise.all([
          fetchNotifications(),
          fetchBadgeCounts(),
          fetchWarehousesSetting(),
        ]).finally(() => setLoading(false));
      } else {
        setLoading(false);
      }
    });
  }, [business?.id, user?.id, fetchSubscription, fetchNotifications, fetchBadgeCounts, fetchWarehousesSetting]);

  // PHASE 3: SSE EventSource listener for real-time notifications
  const sseRefreshDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!business?.id || !user?.id) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;

    console.log(`[SSE] Opening EventSource connection for business ${business.id}, user ${user.id}`);
    
    // Open SSE connection for real-time notifications (business and user-scoped on server)
    const eventSource = new EventSource(`/api/notifications/stream?business_id=${business.id}&user_id=${user.id}`);

    eventSource.onopen = () => {
      console.log('[SSE] EventSource connection opened');
    };

    eventSource.onmessage = (event) => {
      try {
        console.log('[SSE] Received notification event:', event.data);
        try {
          const parsed = JSON.parse(event.data) as {
            notificationId?: string;
            type?: string;
            title?: string;
            message?: string;
            reference_id?: string;
          };
          reminderPipelineLog('client.sse.onmessage', {
            notificationId: parsed?.notificationId,
            type: parsed?.type,
          });
          const nid = parsed.notificationId;
          if (
            parsed.type === 'todo_reminder' &&
            nid &&
            typeof nid === 'string' &&
            !shownReminderIds.current.has(nid)
          ) {
            shownReminderIds.current.add(nid);
            setActiveTodoReminders((prev) => {
              if (prev.some((r) => r.notificationId === nid)) {
                return prev;
              }
              return [
                ...prev,
                {
                  id: `reminder-${nid}`,
                  notificationId: nid,
                  title: parsed.title || 'Reminder',
                  message: parsed.message || parsed.title || 'You have a task reminder',
                  todoId: parsed.reference_id || '',
                  createdAt: new Date().toISOString(),
                },
              ];
            });
            reminderPipelineLog('client.sse.todo_reminder_popup', {
              notificationId: nid,
            });
          }
        } catch {
          // not JSON (ignore)
        }
        // Debounce: Redis can emit bursts; coalesce into one refresh
        if (sseRefreshDebounceRef.current) {
          clearTimeout(sseRefreshDebounceRef.current);
        }
        sseRefreshDebounceRef.current = setTimeout(() => {
          sseRefreshDebounceRef.current = null;
          void fetchNotifications(true);
        }, 400);
      } catch (error) {
        console.error('[SSE] Error processing notification event:', error);
      }
    };

    eventSource.onerror = () => {
      console.warn('[SSE] Notification stream error (will auto-reconnect), readyState:', eventSource.readyState);
      sseErrorLogCountRef.current += 1;
      // EventSource automatically reconnects, no action needed
    };

    // Cleanup on unmount
    return () => {
      if (sseRefreshDebounceRef.current) {
        clearTimeout(sseRefreshDebounceRef.current);
        sseRefreshDebounceRef.current = null;
      }
      console.log('[SSE] Closing EventSource connection');
      eventSource.close();
    };
  }, [business?.id, user?.id, fetchNotifications]);

  // Periodic check for new notifications (fallback - keeps polling as backup)
  useEffect(() => {
    if (!business?.id || !user?.id) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;

    // Force refresh: notification list cache TTL is 5m; skipCache false would keep stale rows and miss new todo_reminders.
    const notificationCheckInterval = setInterval(() => {
      void fetchNotifications(true);
    }, 30000);

    return () => clearInterval(notificationCheckInterval);
  }, [business?.id, user?.id, fetchNotifications]);

  // Clear cache on logout
  useEffect(() => {
    if (!business?.id && !user) {
      cache.clear();
      inFlightRequests.clear();
      hasInitialized.current = false;
      setSnapshotLoaded(false);
      initialNotificationListCommittedRef.current = false;
      shownReminderIds.current = new Set();
      lastNotificationSessionKeyRef.current = '';
      notificationsApplySeqRef.current = 0;
      setActiveTodoReminders([]);
      setData((prev) => ({
        ...prev,
        warehousesSettingLoaded: false,
        enabledFeatureIds: [],
      }));
    }
  }, [business?.id, user]);

  const handleCloseReminder = useCallback((reminderId: string) => {
    setActiveTodoReminders((prev) => prev.filter((r) => r.id !== reminderId));
  }, []);

  return (
    <LayoutDataContext.Provider
      value={{
        ...data,
        loading,
        snapshotLoaded,
        refreshSubscription: fetchSubscription,
        refreshNotifications,
        refreshBadgeCounts,
        refreshPromotion: fetchPromotion,
        refreshWarehouses: refreshWarehouses,
        markNotificationAsRead,
        markAllNotificationsAsRead,
      }}
    >
      {children}
      {/* Render todo reminder popups */}
      {activeTodoReminders.length > 0 && (
        <>
          {activeTodoReminders.map((reminder) => (
            <TodoReminderPopup
              key={reminder.id}
              reminder={reminder}
              onClose={() => handleCloseReminder(reminder.id)}
              onMarkAsRead={markNotificationAsRead}
            />
          ))}
        </>
      )}
    </LayoutDataContext.Provider>
  );
}

export const useLayoutData = () => useContext(LayoutDataContext);

