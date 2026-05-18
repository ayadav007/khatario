'use client';

export const dynamic = 'force-dynamic';

import React, { useState, useEffect } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/contexts/AuthContext';
import { useLayoutData } from '@/contexts/LayoutDataContext';
import { useRouter } from 'next/navigation';
import { 
  Bell, 
  CheckCircle, 
  XCircle, 
  Package, 
  Clock, 
  AlertTriangle, 
  ClipboardList,
  AlertCircle,
  Check,
  Filter
} from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';

interface Notification {
  id: string;
  type: string;
  title: string;
  message: string;
  reference_type?: string;
  reference_id?: string;
  is_read: boolean;
  created_at: string;
  read_at?: string;
}

export default function NotificationsPage() {
  const { business, user } = useAuth();
  const router = useRouter();
  const { 
    notifications, 
    unreadNotificationCount, 
    loading, 
    refreshNotifications, 
    markNotificationAsRead, 
    markAllNotificationsAsRead 
  } = useLayoutData();
  
  const [filter, setFilter] = useState<'all' | 'unread' | 'read'>('all');

  useEffect(() => {
    // Refresh notifications on mount and when page becomes visible
    refreshNotifications();
    
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        refreshNotifications();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [refreshNotifications]);

  const handleMarkAsRead = async (notificationId: string) => {
    await markNotificationAsRead(notificationId);
  };

  const handleMarkAllAsRead = async () => {
    await markAllNotificationsAsRead();
  };

  const handleNotificationClick = (notification: Notification) => {
    handleMarkAsRead(notification.id);
    
    // Navigate based on notification type
    if (notification.type === 'supplier_request') {
      router.push('/suppliers/requests');
    } else if (notification.type === 'low_stock_alert') {
      router.push('/suppliers/dashboard');
    } else if (notification.reference_type === 'supplier' && notification.reference_id) {
      router.push(`/suppliers/${notification.reference_id}`);
    } else if (notification.type === 'invoice_nearing_due' || notification.type === 'invoice_overdue') {
      if (notification.reference_id) {
        router.push(`/invoices/${notification.reference_id}`);
      } else {
        router.push('/invoices');
      }
    } else if (notification.type === 'todo_reminder') {
      router.push('/tools/todo');
    }
  };

  const getNotificationIcon = (type: string) => {
    switch (type) {
      case 'supplier_request':
        return <AlertCircle className="w-5 h-5 text-primary-500" />;
      case 'supplier_approved':
        return <CheckCircle className="w-5 h-5 text-green-500" />;
      case 'supplier_rejected':
        return <XCircle className="w-5 h-5 text-red-500" />;
      case 'low_stock_alert':
        return <Package className="w-5 h-5 text-orange-500" />;
      case 'invoice_nearing_due':
        return <Clock className="w-5 h-5 text-orange-500" />;
      case 'invoice_overdue':
        return <AlertTriangle className="w-5 h-5 text-red-500" />;
      case 'todo_reminder':
        return <ClipboardList className="w-5 h-5 text-primary-500" />;
      default:
        return <Bell className="w-5 h-5 text-gray-500" />;
    }
  };

  const filteredNotifications = notifications.filter((n: Notification) => {
    if (filter === 'unread') return !n.is_read;
    if (filter === 'read') return n.is_read;
    return true;
  });

  return (
    
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-text-primary">Notifications</h1>
            <p className="text-text-secondary text-sm mt-1">
              {unreadNotificationCount > 0 
                ? `${unreadNotificationCount} unread notification${unreadNotificationCount !== 1 ? 's' : ''}`
                : 'All caught up!'}
            </p>
          </div>
          {unreadNotificationCount > 0 && (
            <Button
              onClick={handleMarkAllAsRead}
              variant="secondary"
              size="sm"
            >
              <Check className="w-4 h-4 mr-2" />
              Mark all as read
            </Button>
          )}
        </div>

        {/* Filter Tabs */}
        <div className="flex gap-2 border-b border-gray-200">
          <button
            onClick={() => setFilter('all')}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              filter === 'all'
                ? 'border-primary-500 text-primary-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            All ({notifications.length})
          </button>
          <button
            onClick={() => setFilter('unread')}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              filter === 'unread'
                ? 'border-primary-500 text-primary-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            Unread ({unreadNotificationCount})
          </button>
          <button
            onClick={() => setFilter('read')}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              filter === 'read'
                ? 'border-primary-500 text-primary-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            Read ({notifications.length - unreadNotificationCount})
          </button>
        </div>

        {/* Notifications List */}
        {loading ? (
          <Card padding="lg" className="text-center py-12">
            <div className="animate-spin w-6 h-6 border-2 border-primary-500 border-t-transparent rounded-full mx-auto mb-2"></div>
            <p className="text-text-secondary">Loading notifications...</p>
          </Card>
        ) : filteredNotifications.length === 0 ? (
          <Card padding="lg" className="text-center py-12 border-dashed">
            <Bell className="w-12 h-12 mx-auto text-gray-300 mb-4" />
            <h3 className="text-lg font-medium text-text-primary mb-1">
              {filter === 'unread' ? 'No unread notifications' : 'No notifications'}
            </h3>
            <p className="text-sm text-text-secondary">
              {filter === 'unread' 
                ? "You're all caught up!" 
                : "You don't have any notifications yet."}
            </p>
          </Card>
        ) : (
          <div className="space-y-2">
            {filteredNotifications.map((notification: Notification) => (
              <Card
                key={notification.id}
                padding="none"
                className={`cursor-pointer hover:shadow-md transition-all ${
                  !notification.is_read ? 'bg-slate-50 border-l-4 border-l-primary-500' : ''
                }`}
                onClick={() => handleNotificationClick(notification)}
              >
                <div className="p-4">
                  <div className="flex gap-3">
                    <div className="flex-shrink-0 mt-1">
                      {getNotificationIcon(notification.type)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1">
                          <p className={`text-sm font-medium ${
                            !notification.is_read ? 'text-gray-900' : 'text-gray-700'
                          }`}>
                            {notification.title}
                          </p>
                          <p className="text-sm text-gray-600 mt-1">
                            {notification.message}
                          </p>
                          <p className="text-xs text-gray-400 mt-2">
                            {notification.created_at && !isNaN(new Date(notification.created_at).getTime()) 
                              ? formatDistanceToNow(new Date(notification.created_at), { addSuffix: true })
                              : 'Just now'}
                          </p>
                        </div>
                        {!notification.is_read && (
                          <span className="flex-shrink-0 w-2 h-2 bg-primary-500 rounded-full mt-1"></span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    
  );
}
