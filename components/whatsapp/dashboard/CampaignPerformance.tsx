'use client';

import React from 'react';
import { Card } from '@/components/ui/Card';
import { Send, CheckCircle, Eye, XCircle, Reply } from 'lucide-react';

interface CampaignPerformanceProps {
  data: {
    messages_sent: number;
    delivered: number;
    read: number;
    failed: number;
    responses_received: number;
  } | null;
  loading?: boolean;
}

export function CampaignPerformance({ data, loading }: CampaignPerformanceProps) {
  if (loading) {
    return (
      <Card padding="md">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Campaign Performance</h3>
        <div className="text-center py-8">
          <div className="animate-pulse text-gray-400">Loading...</div>
        </div>
      </Card>
    );
  }

  if (!data) {
    return (
      <Card padding="md">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Campaign Performance</h3>
        <div className="text-center py-8 text-gray-500">
          <Send className="w-12 h-12 mx-auto mb-2 text-gray-300" />
          <p>No campaign data available</p>
        </div>
      </Card>
    );
  }

  const deliveryRate = data.messages_sent > 0 
    ? ((data.delivered / data.messages_sent) * 100).toFixed(1)
    : '0.0';
  
  const readRate = data.delivered > 0
    ? ((data.read / data.delivered) * 100).toFixed(1)
    : '0.0';
  
  const responseRate = data.messages_sent > 0
    ? ((data.responses_received / data.messages_sent) * 100).toFixed(1)
    : '0.0';

  const stats = [
    {
      label: 'Messages Sent',
      value: data.messages_sent.toLocaleString(),
      icon: Send,
      color: 'text-primary-600',
      bgColor: 'bg-slate-50'
    },
    {
      label: 'Delivered',
      value: `${data.delivered.toLocaleString()} (${deliveryRate}%)`,
      icon: CheckCircle,
      color: 'text-green-600',
      bgColor: 'bg-green-50'
    },
    {
      label: 'Read',
      value: `${data.read.toLocaleString()} (${readRate}%)`,
      icon: Eye,
      color: 'text-purple-600',
      bgColor: 'bg-purple-50'
    },
    {
      label: 'Failed',
      value: data.failed.toLocaleString(),
      icon: XCircle,
      color: 'text-red-600',
      bgColor: 'bg-red-50'
    },
    {
      label: 'Responses',
      value: `${data.responses_received.toLocaleString()} (${responseRate}%)`,
      icon: Reply,
      color: 'text-orange-600',
      bgColor: 'bg-orange-50'
    }
  ];

  return (
    <Card padding="md">
      <h3 className="text-lg font-semibold text-gray-900 mb-4">Campaign Performance</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <div
              key={stat.label}
              className={`${stat.bgColor} rounded-lg p-4 border border-gray-200`}
            >
              <div className="flex items-center justify-between mb-2">
                <Icon className={`w-5 h-5 ${stat.color}`} />
              </div>
              <p className="text-2xl font-bold text-gray-900 mb-1">{stat.value.split(' ')[0]}</p>
              <p className="text-xs text-gray-600">{stat.label}</p>
              {stat.value.includes('(') && (
                <p className="text-xs text-gray-500 mt-1">{stat.value.match(/\([^)]+\)/)?.[0]}</p>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

