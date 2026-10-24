'use client';

import { useRenderLoopProbe } from '@/lib/debug/render-loop-detector';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from 'react';
import { useAuth } from './AuthContext';
import { TodoReminderPopup } from '@/components/notifications/TodoReminderPopup';
import { MissedRemindersSummary } from '@/components/notifications/MissedRemindersSummary';
import {
  NotificationStore,
  presentPopups,
  type ClientNotification,
} from '@/lib/notifications/client/notification-store';
import { getNotificationStreamClient } from '@/lib/notifications/client/stream-client';
import { isSeq } from '@/lib/notifications/client/primitives';
import {
  isNotificationSseDisabled,
  recordEventSourceMessage,
  recordFetchNotifications,
} from '@/lib/debug/runtime-isolation';

const DISMISS_BATCH = 50;

export type Notification = ClientNotification;

interface NotificationContextType {
  notifications: Notification[];
  unreadNotificationCount: number;
  refreshNotifications: () => Promise<void>;
  markNotificationAsRead: (id: string) => Promise<void>;
  markAllNotificationsAsRead: () => Promise<void>;
}

const NotificationContext = createContext<NotificationContextType>({
  notifications: [],
  unreadNotificationCount: 0,
  refreshNotifications: async () => {},
  markNotificationAsRead: async () => {},
  markAllNotificationsAsRead: async () => {},
});

/**
 * Notification list, unread count and reminder popups for the signed-in session.
 * Live updates come from the tab's shared stream client (lib/notifications/client); every GET
 * (bootstrap, resync, wake, fallback poll, panel refresh) and every stream event goes through
 * the same NotificationStore, which de-duplicates by notification id and seq.
 */
export function NotificationProvider({ children }: { children: React.ReactNode }) {
  useRenderLoopProbe('NotificationProvider');
  const { business, user, loading: authLoading, refresh: refreshAuth } = useAuth();
  const businessId = business?.id;
  const userId = user?.id;

  const storeRef = useRef<NotificationStore | null>(null);
  if (!storeRef.current) storeRef.current = new NotificationStore();
  const store = storeRef.current;
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);

  const sessionKeyRef = useRef('');
  const inFlightRef = useRef<Promise<string | null> | null>(null);
  const refreshAuthRef = useRef(refreshAuth);
  refreshAuthRef.current = refreshAuth;

  /**
   * GET /api/notifications into the store; resolves with the server's stream_cursor (used only
   * to start a session that has no stored cursor), or null when the server has none. `fresh`
   * waits out an in-flight request instead of joining it, for callers that need a snapshot
   * taken after now (bootstrap, resync).
   */
  const fetchList = useCallback(
    (fresh = false): Promise<string | null> => {
      if (!businessId || !userId) return Promise.resolve(null);
      const key = `${businessId}:${userId}`;
      if (inFlightRef.current && !fresh) return inFlightRef.current;

      const run = async () => {
        const revision = store.listRevision;
        recordFetchNotifications('skip-cache');
        const params = new URLSearchParams({ business_id: businessId, limit: '20', _: String(Date.now()) });
        const res = await fetch(`/api/notifications?${params.toString()}`, {
          credentials: 'include',
          cache: 'no-store',
        });
        if (!res.ok) throw new Error(`GET /api/notifications failed: ${res.status}`);
        const body = (await res.json().catch(() => ({}))) as {
          notifications?: ClientNotification[];
          stream_cursor?: unknown;
        };
        if (sessionKeyRef.current !== key) throw new Error('notification session changed');
        store.applyList(body.notifications ?? [], revision);
        return isSeq(body.stream_cursor) ? body.stream_cursor : null;
      };

      const previous = inFlightRef.current;
      const p = (previous ? previous.catch(() => null).then(run) : run()).finally(() => {
        if (inFlightRef.current === p) inFlightRef.current = null;
      });
      inFlightRef.current = p;
      return p;
    },
    [businessId, userId, store]
  );

  useEffect(() => {
    if (authLoading) return;
    if (!businessId || !userId) {
      sessionKeyRef.current = '';
      store.reset();
      return;
    }
    sessionKeyRef.current = `${businessId}:${userId}`;
    store.reset();

    if (isNotificationSseDisabled()) {
      void fetchList(true).catch(() => {});
      return;
    }

    return getNotificationStreamClient().subscribe({
      session: { businessId, userId },
      onNotification: (payload, { seq }) => {
        recordEventSourceMessage();
        store.applyEvent(payload, seq);
      },
      reconcile: (reason) => fetchList(reason === 'bootstrap' || reason === 'resync'),
      onRemoteDismiss: (keys) => {
        store.dismiss(keys);
      },
      onUnauthorized: () => void refreshAuthRef.current(),
      onForbidden: () => void refreshAuthRef.current(),
    });
  }, [authLoading, businessId, userId, fetchList, store]);

  const refreshNotifications = useCallback(async () => {
    await fetchList().catch((error) => console.error('Failed to fetch notifications:', error));
  }, [fetchList]);

  const markNotificationAsRead = useCallback(
    async (id: string) => {
      store.markRead(id);
      try {
        const response = await fetch(`/api/notifications/${id}/read`, { method: 'PATCH', credentials: 'include' });
        if (!response.ok) await fetchList(true);
      } catch {
        await fetchList(true);
      }
    },
    [store, fetchList]
  );

  const markAllNotificationsAsRead = useCallback(async () => {
    if (!businessId) return;
    store.markAllRead();
    try {
      const response = await fetch('/api/notifications/read-all', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ business_id: businessId }),
      });
      if (!response.ok) await fetchList(true);
    } catch {
      await fetchList(true);
    }
  }, [businessId, store, fetchList]);

  const dismissPopups = useCallback(
    (keys: string[]) => {
      const items = store.dismiss(keys);
      getNotificationStreamClient().broadcastDismiss(keys);
      for (let i = 0; i < items.length; i += DISMISS_BATCH) {
        void fetch('/api/notifications/popups/dismiss', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items: items.slice(i, i + DISMISS_BATCH) }),
        }).catch((error) => console.error('Failed to save reminder dismissal:', error));
      }
    },
    [store]
  );

  const contextValue = useMemo<NotificationContextType>(
    () => ({
      notifications: snapshot.notifications,
      unreadNotificationCount: snapshot.unreadNotificationCount,
      refreshNotifications,
      markNotificationAsRead,
      markAllNotificationsAsRead,
    }),
    [snapshot.notifications, snapshot.unreadNotificationCount, refreshNotifications, markNotificationAsRead, markAllNotificationsAsRead]
  );

  const { mode, popups } = presentPopups(snapshot.popups);

  return (
    <NotificationContext.Provider value={contextValue}>
      {children}
      {mode === 'summary' ? (
        <MissedRemindersSummary reminders={popups} onDismissAll={() => dismissPopups(popups.map((p) => p.key))} />
      ) : (
        popups.map((popup) => (
          <TodoReminderPopup
            key={popup.key}
            reminder={{ ...popup, id: popup.key }}
            onClose={() => dismissPopups([popup.key])}
            onMarkAsRead={markNotificationAsRead}
          />
        ))
      )}
    </NotificationContext.Provider>
  );
}

export const useNotifications = () => useContext(NotificationContext);
