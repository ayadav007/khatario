'use client';

import React from 'react';
import { Card } from '@/components/ui/Card';
import { User, MessageSquare, CheckCircle, XCircle, Clock } from 'lucide-react';

interface AgentPerformanceProps {
  data: Array<{
    agent_id: string;
    agent_name: string;
    total_assigned: number;
    open: number;
    closed: number;
    avg_response_seconds: number | null;
  }> | null;
  loading?: boolean;
}

export function AgentPerformance({ data, loading }: AgentPerformanceProps) {
  if (loading) {
    return (
      <Card padding="md">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Agent Performance</h3>
        <div className="text-center py-8">
          <div className="animate-pulse text-gray-400">Loading...</div>
        </div>
      </Card>
    );
  }

  if (!data || data.length === 0) {
    return (
      <Card padding="md">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Agent Performance</h3>
        <div className="text-center py-8 text-gray-500">
          <User className="w-12 h-12 mx-auto mb-2 text-gray-300" />
          <p>No agent performance data available</p>
        </div>
      </Card>
    );
  }

  const formatResponseTime = (seconds: number | null): string => {
    if (seconds === null || seconds === undefined) return 'N/A';
    if (seconds < 60) return `${Math.round(seconds)}s`;
    if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
    return `${Math.round(seconds / 3600)}h`;
  };

  return (
    <Card padding="md">
      <h3 className="text-lg font-semibold text-gray-900 mb-4">Agent Performance</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200">
              <th className="text-left py-2 px-2 font-medium text-gray-700">Agent</th>
              <th className="text-right py-2 px-2 font-medium text-gray-700">Total</th>
              <th className="text-right py-2 px-2 font-medium text-gray-700">Open</th>
              <th className="text-right py-2 px-2 font-medium text-gray-700">Closed</th>
              <th className="text-right py-2 px-2 font-medium text-gray-700">Avg Response</th>
            </tr>
          </thead>
          <tbody>
            {data.map((agent) => (
              <tr key={agent.agent_id} className="border-b border-gray-100 hover:bg-gray-50">
                <td className="py-3 px-2">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center">
                      <User className="w-4 h-4 text-primary-600" />
                    </div>
                    <span className="font-medium text-gray-900">{agent.agent_name}</span>
                  </div>
                </td>
                <td className="py-3 px-2 text-right">
                  <span className="font-medium text-gray-900">{agent.total_assigned}</span>
                </td>
                <td className="py-3 px-2 text-right">
                  <span className="text-green-600 font-medium">{agent.open}</span>
                </td>
                <td className="py-3 px-2 text-right">
                  <span className="text-gray-600 font-medium">{agent.closed}</span>
                </td>
                <td className="py-3 px-2 text-right">
                  <span className="text-gray-600">{formatResponseTime(agent.avg_response_seconds)}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

