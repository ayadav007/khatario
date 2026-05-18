'use client';

import React from 'react';
import { Card } from '@/components/ui/Card';
import { MessageSquare, Inbox, CheckCircle, Clock, XCircle } from 'lucide-react';

interface StatusOverviewProps {
  data: {
    total: number;
    open: number;
    pending: number;
    closed: number;
    unread: number;
  } | null;
  loading?: boolean;
}

export function StatusOverview({ data, loading }: StatusOverviewProps) {
  if (loading) {
    return (
      <Card padding="md">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Conversation Status</h3>
        <div className="text-center py-8">
          <div className="animate-pulse text-gray-400">Loading...</div>
        </div>
      </Card>
    );
  }

  if (!data) {
    return (
      <Card padding="md">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Conversation Status</h3>
        <div className="text-center py-8 text-gray-500">
          <p>No data available</p>
        </div>
      </Card>
    );
  }

  const stats = [
    {
      label: 'Total',
      value: data.total,
      icon: MessageSquare,
      color: 'text-primary-600',
      bgColor: 'bg-slate-50'
    },
    {
      label: 'Open',
      value: data.open,
      icon: CheckCircle,
      color: 'text-green-600',
      bgColor: 'bg-green-50'
    },
    {
      label: 'Pending',
      value: data.pending,
      icon: Clock,
      color: 'text-orange-600',
      bgColor: 'bg-orange-50'
    },
    {
      label: 'Closed',
      value: data.closed,
      icon: XCircle,
      color: 'text-gray-600',
      bgColor: 'bg-gray-50'
    },
    {
      label: 'Unread',
      value: data.unread,
      icon: Inbox,
      color: 'text-red-600',
      bgColor: 'bg-red-50'
    }
  ];

  return (
    <Card padding="md">
      <h3 className="text-lg font-semibold text-gray-900 mb-4">Conversation Status</h3>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <div
              key={stat.label}
              className={`${stat.bgColor} rounded-lg p-4 border border-gray-200`}
            >
              <div className="flex items-center justify-between mb-2">
                <Icon className={`w-5 h-5 ${stat.color}`} />
                <span className="text-2xl font-bold text-gray-900">{stat.value}</span>
              </div>
              <p className="text-sm text-gray-600">{stat.label}</p>
            </div>
          );
        })}
      </div>

      {/* Simple visual representation */}
      <div className="mt-4 flex gap-1 h-4 bg-gray-200 rounded overflow-hidden">
        {data.total > 0 && (
          <>
            <div
              className="bg-green-500"
              style={{ width: `${(data.open / data.total) * 100}%` }}
              title={`Open: ${data.open}`}
            />
            <div
              className="bg-orange-500"
              style={{ width: `${(data.pending / data.total) * 100}%` }}
              title={`Pending: ${data.pending}`}
            />
            <div
              className="bg-gray-500"
              style={{ width: `${(data.closed / data.total) * 100}%` }}
              title={`Closed: ${data.closed}`}
            />
          </>
        )}
      </div>
    </Card>
  );
}

