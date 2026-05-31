'use client';

import { useRenderLoopProbe } from '@/lib/debug/render-loop-detector';
import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from 'react';
import { useAuth } from './AuthContext';
import { TodoReminderPopup } from '@/components/notifications/TodoReminderPopup';
import { reminderPipelineLog } from '@/lib/reminder-pipeline-log';
import { useNetworkStatus } from '@/hooks/useNetworkStatus';
import {
  fetchWithDedup,
  getCacheKey,
  invalidateCacheKey,
  isCacheValid,
  readCacheEntry,
  setCacheEntry,
} from '@/lib/layout-data/fetch-cache';

/** Server upserts re-fire `created_at`; fetch-only fallback is gated (first list paint skipped) + `shownReminderIds`. */
const TODO_REMINDER_RECENT_AGE_MS = 10 * 60 * 1000;
/** Coalesce SSE notification bursts before forcing a list refresh. */
const SSE_NOTIFICATION_DEBOUNCE_MS = 750;

export interface Notification {
  id: string;
  type: string;
  title: string;
  message: string;
  is_read: boolean;
  created_at: string;
  [key: string]: unknown;
}

function notificationsPayloadUnchanged(
  prevList: Notification[],
  nextList: Notification[],
  prevUnread: number,
  nextUnread: number
): boolean {
  if (prevUnread !== nextUnread || prevList.length !== nextList.length) return false;
  for (let i = 0; i < prevList.length; i++) {
    const a = prevList[i];
    const b = nextList[i];
    if (a.id !== b.id || !!a.is_read !== !!b.is_read) return false;
  }
  return true;
}

interface NotificationState {
  notifications: Notification[];
  unreadNotificationCount: number;
}

interface NotificationContextType extends NotificationState {
  refreshNotifications: () => Promise<void>;
  markNotificationAsRead: (id: string) => Promise<void>;
  markAllNotificationsAsRead: () => Promise<void>;
}

const defaultState: NotificationState = {
  notifications: [],
  unreadNotificationCount: 0,
};

const NotificationContext = createContext<NotificationContextType>({
  ...defaultState,
  refreshNotifications: async () => {},
  markNotificationAsRead: async () => {},
  markAllNotificationsAsRead: async () => {},
});

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  useRenderLoopProbe('NotificationProvider');
  const { business, user } = useAuth();
  const { isOnline, lastChangedAt } = useNetworkStatus();
  const prevOnlineRef = useRef(isOnline);

  const [state, setState] = useState<NotificationState>(defaultState);
  const [activeTodoReminders, setActiveTodoReminders] = useState<
    Array<{
      id: string;
      notificationId: string;
      title: string;
      message: string;
      todoId: string;
      createdAt: string;
    }>
  >([]);
  const shownReminderIds = useRef<Set<string>>(new Set());
  const initialNotificationListCommittedRef = useRef(false);
  const lastNotificationSessionKeyRef = useRef('');
  const notificationsApplySeqRef = useRef(0);
  const sseErrorLogCountRef = useRef(0);

  const fetchNotificationTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastFetchTimeRef = useRef<number>(0);
  const MIN_FETCH_INTERVAL = 10000;
  const notificationsSkipCacheInFlightRef = useRef<Promise<void> | null>(null);

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

    const applyNotificationResult = (normalizedNotifications: Notification[], unreadCount: number) => {
      const wasCommitted = initialNotificationListCommittedRef.current;
      if (!initialNotificationListCommittedRef.current) {
        initialNotificationListCommittedRef.current = true;
      }

      const rowById = new Map(
        normalizedNotifications
          .filter((n) => n?.id && n?.type === 'todo_reminder')
          .map((n) => [n.id, n] as const)
      );

      setActiveTodoReminders((prev) => {
        if (prev.length === 0 && !wasCommitted) {
          return prev;
        }

        let next = prev.map((r) => {
          const row = rowById.get(r.notificationId);
          if (!row) return r;
          return {
            ...r,
            title: row.title || r.title,
            message: row.message || r.message,
            todoId: (row.reference_id as string) || r.todoId,
            createdAt: row.created_at || r.createdAt,
          };
        });

        if (wasCommitted) {
          const nowMs = Date.now();
          const fromFetch = normalizedNotifications.filter((n) => {
            if (
              n?.type !== 'todo_reminder' ||
              n.is_read ||
              shownReminderIds.current.has(n.id) ||
              !n.created_at
            ) {
              return false;
            }
            const age = nowMs - new Date(n.created_at).getTime();
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
              ...toAdd.map((n) => ({
                id: `reminder-${n.id}`,
                notificationId: n.id,
                title: n.title || 'Reminder',
                message: n.message || n.title || 'You have a task reminder',
                todoId: (n.reference_id as string) || '',
                createdAt: n.created_at,
              })),
            ];
          }
        }
        return next;
      });

      const unreadTodoReminders = normalizedNotifications.filter(
        (n) => n?.type === 'todo_reminder' && !n.is_read
      );

      reminderPipelineLog('client.apply_notification_result', {
        path: 'fetch_sync_fallback',
        wasCommitted,
        totalCount: normalizedNotifications.length,
        unreadTodoReminderCount: unreadTodoReminders.length,
        shownTodoReminderCount: shownReminderIds.current.size,
      });

      setState((prev) => {
        if (
          notificationsPayloadUnchanged(
            prev.notifications,
            normalizedNotifications,
            prev.unreadNotificationCount,
            unreadCount
          )
        ) {
          return prev;
        }
        return {
          notifications: normalizedNotifications,
          unreadNotificationCount: unreadCount,
        };
      });
    };

    if (fetchNotificationTimeoutRef.current) {
      clearTimeout(fetchNotificationTimeoutRef.current);
      fetchNotificationTimeoutRef.current = null;
    }

    const now = Date.now();
    const timeSinceLastFetch = now - lastFetchTimeRef.current;

    if (!skipCache && timeSinceLastFetch < MIN_FETCH_INTERVAL) {
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
        const cacheKey = getCacheKey('/api/notifications', {
          business_id: business.id,
          user_id: user.id,
          limit: '20',
        });

        if (skipCache) {
          invalidateCacheKey(cacheKey);
        }

        if (!skipCache && isCacheValid(cacheKey)) {
          const cached = readCacheEntry<{
            notifications: Notification[];
            unreadCount?: number;
            unread_count?: number;
          }>(cacheKey)!;
          const normalizedNotifications = (cached.notifications || []).map((n) => ({
            ...n,
            is_read: n.is_read !== undefined ? n.is_read : ((n as { read?: boolean }).read === true),
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
            cached.unreadCount || cached.unread_count || 0
          );
          return;
        }

        type NotificationsApiRes = {
          notifications: Notification[];
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
          res = await fetchWithDedup<NotificationsApiRes>('/api/notifications', {
            business_id: business.id,
            user_id: user.id,
            limit: '20',
          });
        }

        const normalizedNotifications = (res.notifications || []).map((n) => ({
          ...n,
          is_read: n.is_read !== undefined ? n.is_read : ((n as { read?: boolean }).read === true),
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
          invalidateCacheKey(cacheKey);
          return;
        }
        if (skipCache) {
          setCacheEntry(cacheKey, res);
        }
        applyNotificationResult(normalizedNotifications, res.unreadCount || res.unread_count || 0);
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

  const refreshNotifications = useCallback((): Promise<void> => {
    return fetchNotifications(true);
  }, [fetchNotifications]);

  const markNotificationAsRead = useCallback(
    async (id: string) => {
      try {
        setState((prev) => ({
          notifications: prev.notifications.map((n) =>
            n.id === id ? { ...n, is_read: true, read_at: new Date().toISOString() } : n
          ),
          unreadNotificationCount: Math.max(0, prev.unreadNotificationCount - 1),
        }));

        const response = await fetch(`/api/notifications/${id}/read`, { method: 'PATCH' });

        if (!response.ok) {
          const errorData = await response.json();
          console.error('Failed to mark notification as read:', errorData);
          await fetchNotifications(true);
        }
      } catch (error) {
        console.error('Failed to mark notification as read:', error);
        await fetchNotifications(true);
      }
    },
    [fetchNotifications]
  );

  const markAllNotificationsAsRead = useCallback(async () => {
    if (!business?.id || !user?.id) return;

    try {
      setState((prev) => ({
        notifications: prev.notifications.map((n) => ({
          ...n,
          is_read: true,
          read_at: new Date().toISOString(),
        })),
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
        await fetchNotifications(true);
      }
    } catch (error) {
      console.error('Failed to mark all notifications as read:', error);
      await fetchNotifications(true);
    }
  }, [business?.id, user?.id, fetchNotifications]);

  useEffect(() => {
    if (!business?.id || !user?.id) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;
    void fetchNotifications();
  }, [business?.id, user?.id, fetchNotifications]);

  useEffect(() => {
    if (!business?.id || !user?.id) return;

    const wasOffline = !prevOnlineRef.current;
    prevOnlineRef.current = isOnline;

    if (!isOnline || !wasOffline) return;

    void fetchNotifications(true);
  }, [isOnline, lastChangedAt, business?.id, user?.id, fetchNotifications]);

  const sseRefreshDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!business?.id || !user?.id) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;

    console.log(`[SSE] Opening EventSource connection for business ${business.id}, user ${user.id}`);

    const eventSource = new EventSource(
      `/api/notifications/stream?business_id=${business.id}&user_id=${user.id}`
    );

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
        if (sseRefreshDebounceRef.current) {
          clearTimeout(sseRefreshDebounceRef.current);
        }
        sseRefreshDebounceRef.current = setTimeout(() => {
          sseRefreshDebounceRef.current = null;
          if (typeof document !== 'undefined' && document.hidden) return;
          void fetchNotifications(true);
        }, SSE_NOTIFICATION_DEBOUNCE_MS);
      } catch (error) {
        console.error('[SSE] Error processing notification event:', error);
      }
    };

    eventSource.onerror = () => {
      console.warn('[SSE] Notification stream error (will auto-reconnect), readyState:', eventSource.readyState);
      sseErrorLogCountRef.current += 1;
    };

    return () => {
      if (sseRefreshDebounceRef.current) {
        clearTimeout(sseRefreshDebounceRef.current);
        sseRefreshDebounceRef.current = null;
      }
      console.log('[SSE] Closing EventSource connection');
      eventSource.close();
    };
  }, [business?.id, user?.id, fetchNotifications]);

  useEffect(() => {
    if (!business?.id || !user?.id) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;

    let interval: ReturnType<typeof setInterval> | null = null;

    const tick = () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      void fetchNotifications(true);
    };

    const startPolling = () => {
      if (interval || (typeof document !== 'undefined' && document.hidden)) return;
      interval = setInterval(tick, 30000);
    };

    const stopPolling = () => {
      if (!interval) return;
      clearInterval(interval);
      interval = null;
    };

    const onVisibilityChange = () => {
      if (document.hidden) {
        stopPolling();
      } else {
        tick();
        startPolling();
      }
    };

    startPolling();
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      stopPolling();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [business?.id, user?.id, fetchNotifications]);

  useEffect(() => {
    if (business?.id || user) return;
    initialNotificationListCommittedRef.current = false;
    shownReminderIds.current = new Set();
    lastNotificationSessionKeyRef.current = '';
    notificationsApplySeqRef.current = 0;
    setActiveTodoReminders([]);
    setState(defaultState);
  }, [business?.id, user]);

  const handleCloseReminder = useCallback((reminderId: string) => {
    setActiveTodoReminders((prev) => prev.filter((r) => r.id !== reminderId));
  }, []);

  const contextValue = useMemo<NotificationContextType>(
    () => ({
      ...state,
      refreshNotifications,
      markNotificationAsRead,
      markAllNotificationsAsRead,
    }),
    [state, refreshNotifications, markNotificationAsRead, markAllNotificationsAsRead]
  );

  return (
    <NotificationContext.Provider value={contextValue}>
      {children}
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
    </NotificationContext.Provider>
  );
}

export const useNotifications = () => useContext(NotificationContext);
