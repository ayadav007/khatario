'use client';

export const dynamic = 'force-dynamic';

import React, { useState, useEffect } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { ArrowLeft, Activity, User, Calendar, Filter, Loader2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import Link from 'next/link';
import { format } from 'date-fns';
import { SETTINGS_CONTENT_WIDTH } from '@/lib/settings-page-layout';

interface ActivityLog {
  id: string;
  user_id: string;
  user_name: string;
  current_user_name?: string;
  user_phone?: string;
  action: string;
  module: string;
  entity_type?: string;
  entity_id?: string;
  details?: any;
  ip_address?: string;
  created_at: string;
}

export default function ActivityLogPage() {
  const { business, user } = useAuth();
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterModule, setFilterModule] = useState('all');
  const [filterUser, setFilterUser] = useState('all');
  const [users, setUsers] = useState<any[]>([]);

  useEffect(() => {
    if (business?.id) {
      fetchLogs();
      fetchUsers();
    }
  }, [business?.id, filterModule, filterUser]);

  const fetchLogs = async () => {
    setLoading(true);
    try {
      let url = `/api/settings/activity-logs?business_id=${business?.id}&limit=100`;
      if (filterModule !== 'all') {
        url += `&module=${filterModule}`;
      }
      if (filterUser !== 'all') {
        url += `&user_id=${filterUser}`;
      }

      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setLogs(data.logs);
      }
    } catch (error) {
      console.error('Failed to fetch activity logs:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchUsers = async () => {
    try {
      const res = await fetch(`/api/settings/users?business_id=${business?.id}&user_id=${user?.id}`);
      if (res.ok) {
        const data = await res.json();
        setUsers(data.users);
      }
    } catch (error) {
      console.error('Failed to fetch users:', error);
    }
  };

  const getActionLabel = (action: string) => {
    const actionMap: Record<string, string> = {
      'create_invoice': 'Created Invoice',
      'update_invoice': 'Updated Invoice',
      'delete_invoice': 'Deleted Invoice',
      'create_purchase': 'Created Purchase',
      'update_purchase': 'Updated Purchase',
      'delete_purchase': 'Deleted Purchase',
      'create_customer': 'Created Customer',
      'update_customer': 'Updated Customer',
      'delete_customer': 'Deleted Customer',
      'create_supplier': 'Created Supplier',
      'update_supplier': 'Updated Supplier',
      'delete_supplier': 'Deleted Supplier',
      'create_user': 'Created User',
      'update_user': 'Updated User',
      'delete_user': 'Deleted User',
      'create_role': 'Created Role',
      'update_role_permissions': 'Updated Role Permissions',
      'update_user_management_settings': 'Updated Settings',
    };
    return actionMap[action] || action;
  };

  const getActionColor = (action: string) => {
    if (action.includes('create')) return 'text-green-600 bg-green-50';
    if (action.includes('update') || action.includes('edit')) return 'text-primary-600 bg-slate-50';
    if (action.includes('delete')) return 'text-red-600 bg-red-50';
    return 'text-text-secondary bg-gray-50 dark:bg-slate-800/40';
  };

  return (
      <div className={`${SETTINGS_CONTENT_WIDTH} space-y-6`}>
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/settings">
              <Button variant="ghost" size="sm">
                <ArrowLeft className="w-4 h-4" />
              </Button>
            </Link>
            <div>
              <h1 className="text-2xl font-bold text-text-primary">Activity Log</h1>
              <p className="text-text-secondary text-sm mt-1">Track all user actions and changes</p>
            </div>
          </div>
        </div>

        {/* Filters */}
        <Card padding="md">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1">
              <label className="block text-sm font-medium text-text-secondary mb-1">
                <Filter className="w-4 h-4 inline mr-1" />
                Filter by Module
              </label>
              <select
                value={filterModule}
                onChange={(e) => setFilterModule(e.target.value)}
                className="input"
              >
                <option value="all">All Modules</option>
                <option value="invoices">Invoices</option>
                <option value="purchases">Purchases</option>
                <option value="customers">Customers</option>
                <option value="suppliers">Suppliers</option>
                <option value="items">Items</option>
                <option value="payments">Payments</option>
                <option value="settings">Settings</option>
              </select>
            </div>

            <div className="flex-1">
              <label className="block text-sm font-medium text-text-secondary mb-1">
                <User className="w-4 h-4 inline mr-1" />
                Filter by User
              </label>
              <select
                value={filterUser}
                onChange={(e) => setFilterUser(e.target.value)}
                className="input"
              >
                <option value="all">All Users</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </Card>

        {/* Activity Log */}
        <Card padding="none">
          {loading ? (
            <div className="p-8 flex justify-center">
              <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
            </div>
          ) : (
            <div className="divide-y divide-gray-200">
              {logs.length > 0 ? (
                logs.map((log) => (
                  <div key={log.id} className="p-4 hover:bg-gray-50 dark:bg-slate-800/40 dark:hover:bg-slate-800/70 transition">
                    <div className="flex items-start gap-4">
                      <div className="w-10 h-10 bg-slate-100 rounded-full flex items-center justify-center flex-shrink-0">
                        <Activity className="w-5 h-5 text-primary-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-medium text-text-primary">
                            {log.current_user_name || log.user_name}
                          </span>
                          <span
                            className={`inline-flex px-2 py-1 rounded-md text-xs font-medium ${getActionColor(
                              log.action
                            )}`}
                          >
                            {getActionLabel(log.action)}
                          </span>
                          <span className="text-xs text-text-muted uppercase">
                            {log.module}
                          </span>
                        </div>

                        {log.details && Object.keys(log.details).length > 0 && (
                          <div className="text-sm text-text-secondary mb-2">
                            {JSON.stringify(log.details, null, 2)
                              .replace(/[{}"]/g, '')
                              .split(',')
                              .map((item, i) => (
                                <span key={i} className="mr-3">
                                  {item.trim()}
                                </span>
                              ))}
                          </div>
                        )}

                        <div className="flex items-center gap-4 text-xs text-text-muted">
                          <span className="flex items-center gap-1">
                            <Calendar className="w-3 h-3" />
                            {format(new Date(log.created_at), 'dd MMM yyyy, hh:mm a')}
                          </span>
                          {log.user_phone && (
                            <span>Phone: {log.user_phone}</span>
                          )}
                          {log.ip_address && (
                            <span>IP: {log.ip_address}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="p-12 text-center">
                  <Activity className="w-12 h-12 text-text-muted mx-auto mb-4" />
                  <p className="text-text-secondary">No activity logs found</p>
                </div>
              )}
            </div>
          )}
        </Card>
      </div>
    
  );
}

