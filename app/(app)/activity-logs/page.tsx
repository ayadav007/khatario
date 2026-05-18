'use client';

export const dynamic = 'force-dynamic';

import React, { useState, useEffect } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Activity, Filter, Loader2, Search } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { ActivityLog } from '@/types/database';
import { format } from 'date-fns';

interface ActivityLogWithDetails extends ActivityLog {
  employee_code?: string;
  user_name?: string;
  user_email?: string;
}

export default function ActivityLogsPage() {
  const { business } = useAuth();
  const [logs, setLogs] = useState<ActivityLogWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [moduleFilter, setModuleFilter] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [startDate, setStartDate] = useState(format(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), 'yyyy-MM-dd'));
  const [endDate, setEndDate] = useState(format(new Date(), 'yyyy-MM-dd'));

  useEffect(() => {
    if (business?.id) {
      fetchLogs();
    }
  }, [business?.id, moduleFilter, actionFilter, startDate, endDate]);

  const fetchLogs = async () => {
    if (!business?.id) return;

    setLoading(true);
    try {
      const params = new URLSearchParams({
        business_id: business.id,
        start_date: startDate,
        end_date: endDate,
        ...(moduleFilter && { module: moduleFilter }),
        ...(actionFilter && { action_type: actionFilter }),
      });

      const res = await fetch(`/api/activity-logs?${params}`);
      if (res.ok) {
        const data = await res.json();
        setLogs(data.logs || []);
      }
    } catch (error) {
      console.error('Error fetching activity logs:', error);
    } finally {
      setLoading(false);
    }
  };

  const getActionColor = (actionType: string) => {
    if (actionType.includes('create')) return 'text-green-600';
    if (actionType.includes('update') || actionType.includes('edit')) return 'text-primary-600';
    if (actionType.includes('delete')) return 'text-red-600';
    if (actionType.includes('approve')) return 'text-green-600';
    if (actionType.includes('reject')) return 'text-red-600';
    return 'text-gray-600';
  };

  return (
    
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-text-primary">Activity Logs</h1>
            <p className="text-sm text-text-secondary mt-1">View all user activities and actions</p>
          </div>
        </div>

        <Card>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Input
              label="Start Date"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
            <Input
              label="End Date"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">
                Module
              </label>
              <select
                value={moduleFilter}
                onChange={(e) => setModuleFilter(e.target.value)}
                className="input"
              >
                <option value="">All Modules</option>
                <option value="invoices">Invoices</option>
                <option value="items">Items</option>
                <option value="customers">Customers</option>
                <option value="employees">Employees</option>
                <option value="attendance">Attendance</option>
                <option value="commissions">Commissions</option>
                <option value="leaves">Leaves</option>
                <option value="expenses">Expenses</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">
                Action Type
              </label>
              <select
                value={actionFilter}
                onChange={(e) => setActionFilter(e.target.value)}
                className="input"
              >
                <option value="">All Actions</option>
                <option value="create">Create</option>
                <option value="update">Update</option>
                <option value="delete">Delete</option>
                <option value="approve">Approve</option>
                <option value="reject">Reject</option>
                <option value="login">Login</option>
                <option value="logout">Logout</option>
              </select>
            </div>
          </div>
        </Card>

        <Card>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
            </div>
          ) : logs.length === 0 ? (
            <div className="text-center py-12">
              <Activity className="w-12 h-12 text-gray-300 mx-auto mb-4" />
              <p className="text-text-secondary">No activity logs found</p>
            </div>
          ) : (
            <div className="space-y-3">
              {logs.map((log) => (
                <div
                  key={log.id}
                  className="border-b border-border pb-3 last:border-b-0"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`font-medium capitalize ${getActionColor(log.action_type)}`}>
                          {log.action_type}
                        </span>
                        <span className="text-text-secondary">•</span>
                        <span className="text-sm font-medium">{log.module}</span>
                        {log.user_name && (
                          <>
                            <span className="text-text-secondary">•</span>
                            <span className="text-sm text-text-secondary">
                              {log.user_name}
                              {log.employee_code && ` (${log.employee_code})`}
                            </span>
                          </>
                        )}
                      </div>
                      <p className="text-sm text-text-secondary">{log.description}</p>
                      <div className="flex items-center gap-4 mt-2 text-xs text-text-secondary">
                        <span>{format(new Date(log.created_at), 'dd MMM yyyy HH:mm:ss')}</span>
                        {log.ip_address && <span>IP: {log.ip_address}</span>}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    
  );
}

