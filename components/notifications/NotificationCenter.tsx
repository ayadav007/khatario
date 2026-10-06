'use client';

import React, { useState, useEffect } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Bell, X, Check, AlertCircle, Info, CheckCircle, AlertTriangle } from 'lucide-react';

import { format } from 'date-fns';
import { useNotifications } from '@/contexts/NotificationContext';

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
            Mobile: fixed panel inset from viewport edges (escapes overflow-x-hidden shell).
            Desktop: anchored dropdown under the bell.
          */}
          <Card
            padding="md"
            className="fixed z-[70] flex max-h-[min(70dvh,32rem)] w-auto flex-col overflow-hidden shadow-lg
              left-3 right-3 top-[calc(env(safe-area-inset-top,0px)+3.75rem)]
              lg:absolute lg:left-auto lg:right-0 lg:top-full lg:mt-2 lg:w-96 lg:max-h-[600px]"
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
                  return (
                    <div
                      key={notification.id}
                      className={`rounded-lg border p-3 ${
                        notification.is_read
                          ? 'border-gray-200 bg-gray-50'
                          : 'border-primary-200 bg-white'
                      }`}
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
                                onClick={() => markNotificationAsRead(notification.id)}
                                className="shrink-0 rounded p-1 transition-colors hover:bg-gray-100"
                                aria-label="Mark as read"
                              >
                                <Check className="h-4 w-4 text-gray-400" />
                              </button>
                            )}
                          </div>
                          {typeof notification.actionUrl === 'string' && notification.actionUrl && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="mt-2"
                              onClick={() => {
                                window.location.href = notification.actionUrl as string;
                              }}
                            >
                              {(typeof notification.actionLabel === 'string'
                                ? notification.actionLabel
                                : null) || 'View'}
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </Card>
        </>
      )}
    </div>
  );
};
