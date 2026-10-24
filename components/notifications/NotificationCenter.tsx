'use client';

import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/Button';
import { Bell, X, Check, AlertCircle, Info, CheckCircle, AlertTriangle } from 'lucide-react';

import { format } from 'date-fns';
import { useRouter } from 'next/navigation';
import { useNotifications } from '@/contexts/NotificationContext';
import { notificationHref } from '@/lib/notifications/notification-href';

export interface Notification {
  id: string;
  type: 'info' | 'success' | 'warning' | 'error';
  title: string;
  message: string;
  timestamp: string;
  read: boolean;
  actionUrl?: string;
  actionLabel?: string;
}

interface NotificationCenterProps {
  businessId: string;
}

export const NotificationCenter: React.FC<NotificationCenterProps> = ({ businessId }) => {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const { notifications, unreadNotificationCount, refreshNotifications, markNotificationAsRead, markAllNotificationsAsRead } = useNotifications();

  // TopBar mounts two NotificationCenter instances (mobile + desktop, CSS-hidden). Do not refresh on mount
  // or visibility — that doubled force-refreshes. NotificationProvider's stream client keeps the list current;
  // refresh when the user opens the panel (same pattern as NotificationPanel).
  useEffect(() => {
    if (isOpen) {
      refreshNotifications();
    }
  }, [isOpen, refreshNotifications]);

  const open = (id: string, href: string) => {
    markNotificationAsRead(id);
    setIsOpen(false);
    router.push(href);
  };

  const getIcon = (type: Notification['type']) => {
    switch (type) {
      case 'success':
        return CheckCircle;
      case 'warning':
        return AlertTriangle;
      case 'error':
        return AlertCircle;
      default:
        return Info;
    }
  };

  const getColor = (type: Notification['type']) => {
    switch (type) {
      case 'success':
        return 'text-green-600 bg-green-50';
      case 'warning':
        return 'text-yellow-600 bg-yellow-50';
      case 'error':
        return 'text-red-600 bg-red-50';
      default:
        return 'text-primary-600 bg-slate-50';
    }
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 hover:bg-slate-50 rounded-lg transition-colors"
        aria-label="Notifications"
        aria-expanded={isOpen}
      >
        <Bell className="w-5 h-5 text-text-secondary" />
        {unreadNotificationCount > 0 && (
          <span className="absolute top-0 right-0 w-5 h-5 bg-red-500 text-white text-xs rounded-full flex items-center justify-center">
            {unreadNotificationCount > 9 ? '9+' : unreadNotificationCount}
          </span>
        )}
      </button>

      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-[60] bg-black/20 lg:bg-transparent"
            onClick={() => setIsOpen(false)}
            aria-hidden
          />
          {/*
            Do not use Card here. Card sets max-w-full, and this panel is absolutely
            positioned against the bell button, so 100% width collapses to the icon
            and overflow-hidden clips the list.
            Mobile: fixed panel inset from the viewport (escapes overflow-x-hidden).
            Desktop: explicit width, anchored under the bell.
          */}
          <div
            role="dialog"
            aria-label="Notifications"
            className="fixed z-[70] flex max-h-[min(70dvh,32rem)] w-auto min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-surface p-4 shadow-lg dark:border-border-dark dark:bg-surface-dark
              left-3 right-3 top-[calc(env(safe-area-inset-top,0px)+3.75rem)]
              lg:absolute lg:left-auto lg:right-0 lg:top-full lg:mt-2 lg:w-96 lg:max-w-[min(24rem,calc(100vw-1.5rem))] lg:max-h-[600px]"
          >
            <div className="mb-3 flex items-center justify-between gap-2 border-b border-gray-200 pb-3 lg:mb-4 lg:pb-4">
              <h3 className="text-base font-semibold text-text-primary lg:text-lg">Notifications</h3>
              <div className="flex shrink-0 items-center gap-1">
                {unreadNotificationCount > 0 && (
                  <Button variant="ghost" size="sm" onClick={markAllNotificationsAsRead}>
                    Mark all read
                  </Button>
                )}
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="rounded p-1 transition-colors hover:bg-gray-100"
                  aria-label="Close notifications"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain">
              {notifications.length === 0 ? (
                <div className="py-8 text-center text-gray-500">
                  <Bell className="mx-auto mb-2 h-12 w-12 text-gray-300" />
                  <p>No notifications</p>
                </div>
              ) : (
                notifications.map((notification) => {
                  const Icon = getIcon(notification.type as Notification['type']);
                  const href = notificationHref(notification);
                  return (
                    <div
                      key={notification.id}
                      role={href ? 'button' : undefined}
                      tabIndex={href ? 0 : undefined}
                      onClick={href ? () => open(notification.id, href) : undefined}
                      onKeyDown={
                        href
                          ? (e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                open(notification.id, href);
                              }
                            }
                          : undefined
                      }
                      className={`rounded-lg border p-3 ${
                        notification.is_read
                          ? 'border-gray-200 bg-gray-50'
                          : 'border-primary-200 bg-white'
                      }${href ? ' cursor-pointer transition-colors hover:border-primary-300' : ''}`}
                    >
                      <div className="flex items-start gap-3">
                        <div className={`rounded-lg p-2 ${getColor(notification.type as Notification['type'])}`}>
                          <Icon className="h-4 w-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium text-text-primary break-words">
                                {notification.title}
                              </p>
                              <p className="mt-1 text-sm text-text-secondary break-words">
                                {notification.message}
                              </p>
                              <p className="mt-1 text-xs text-gray-400">
                                {format(
                                  new Date(
                                    notification.created_at ||
                                      (typeof notification.timestamp === 'string'
                                        ? notification.timestamp
                                        : '')
                                  ),
                                  'MMM dd, hh:mm a'
                                )}
                              </p>
                            </div>
                            {!notification.is_read && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  markNotificationAsRead(notification.id);
                                }}
                                className="shrink-0 rounded p-1 transition-colors hover:bg-gray-100"
                                aria-label="Mark as read"
                              >
                                <Check className="h-4 w-4 text-gray-400" />
                              </button>
                            )}
                          </div>
                          {href && (
                            <p className="mt-2 text-xs font-medium text-primary-600">
                              {(typeof notification.actionLabel === 'string' && notification.actionLabel) || 'Open'} ›
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};
