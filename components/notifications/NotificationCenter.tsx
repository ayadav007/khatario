'use client';

import React, { useState, useEffect } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Bell, X, Check, AlertCircle, Info, CheckCircle, AlertTriangle } from 'lucide-react';

import { format } from 'date-fns';
import { useLayoutData } from '@/contexts/LayoutDataContext';

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
  const { notifications, unreadNotificationCount, refreshNotifications, markNotificationAsRead, markAllNotificationsAsRead } = useLayoutData();

  // TopBar mounts two NotificationCenter instances (mobile + desktop, CSS-hidden). Do not refresh on mount
  // or visibility — that doubled force-refreshes. Bootstrap + SSE + 30s poll in LayoutDataContext load the list;
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
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 hover:bg-slate-50 rounded-lg transition-colors"
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
            className="fixed inset-0 z-40"
            onClick={() => setIsOpen(false)}
          />
          <Card
            padding="md"
            className="absolute right-0 top-full mt-2 w-96 max-h-[600px] overflow-hidden flex flex-col z-50 shadow-lg"
          >
            <div className="flex items-center justify-between mb-4 pb-4 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-text-primary">Notifications</h3>
              <div className="flex items-center gap-2">
                {unreadNotificationCount > 0 && (
                  <Button variant="ghost" size="sm" onClick={markAllNotificationsAsRead}>
                    Mark all read
                  </Button>
                )}
                <button
                  onClick={() => setIsOpen(false)}
                  className="p-1 hover:bg-gray-100 rounded transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto space-y-2">
              {notifications.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <Bell className="w-12 h-12 mx-auto mb-2 text-gray-300" />
                  <p>No notifications</p>
                </div>
              ) : (
                notifications.map((notification) => {
                  const Icon = getIcon(notification.type as Notification['type']);
                  return (
                    <div
                      key={notification.id}
                      className={`p-3 rounded-lg border ${
                        notification.is_read
                          ? 'bg-gray-50 border-gray-200'
                          : 'bg-white border-primary-200'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <div className={`p-2 rounded-lg ${getColor(notification.type as Notification['type'])}`}>
                          <Icon className="w-4 h-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1">
                              <p className="font-medium text-text-primary text-sm">
                                {notification.title}
                              </p>
                              <p className="text-sm text-text-secondary mt-1">
                                {notification.message}
                              </p>
                              <p className="text-xs text-gray-400 mt-1">
                                {format(new Date(notification.created_at || notification.timestamp), 'MMM dd, hh:mm a')}
                              </p>
                            </div>
                            {!notification.is_read && (
                              <button
                                onClick={() => markNotificationAsRead(notification.id)}
                                className="p-1 hover:bg-gray-100 rounded transition-colors"
                              >
                                <Check className="w-4 h-4 text-gray-400" />
                              </button>
                            )}
                          </div>
                          {notification.actionUrl && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="mt-2"
                              onClick={() => {
                                window.location.href = notification.actionUrl!;
                              }}
                            >
                              {notification.actionLabel || 'View'}
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

