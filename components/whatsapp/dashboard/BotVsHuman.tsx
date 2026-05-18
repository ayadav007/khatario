'use client';

import React from 'react';
import { Card } from '@/components/ui/Card';
import { Bot, User, ArrowRightLeft } from 'lucide-react';

interface BotVsHumanProps {
  data: {
    bot_handled: number;
    human_handled: number;
    handoff_count: number;
  } | null;
  loading?: boolean;
}

export function BotVsHuman({ data, loading }: BotVsHumanProps) {
  if (loading) {
    return (
      <Card padding="md">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Bot vs Human</h3>
        <div className="text-center py-8">
          <div className="animate-pulse text-gray-400">Loading...</div>
        </div>
      </Card>
    );
  }

  if (!data) {
    return (
      <Card padding="md">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Bot vs Human</h3>
        <div className="text-center py-8 text-gray-500">
          <Bot className="w-12 h-12 mx-auto mb-2 text-gray-300" />
          <p>No automation data available</p>
        </div>
      </Card>
    );
  }

  const total = data.bot_handled + data.human_handled;
  const botPercentage = total > 0 ? ((data.bot_handled / total) * 100).toFixed(1) : '0.0';
  const humanPercentage = total > 0 ? ((data.human_handled / total) * 100).toFixed(1) : '0.0';

  return (
    <Card padding="md">
      <h3 className="text-lg font-semibold text-gray-900 mb-4">Bot vs Human</h3>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
        <div className="bg-purple-50 rounded-lg p-4 border border-purple-200">
          <div className="flex items-center justify-between mb-2">
            <Bot className="w-6 h-6 text-purple-600" />
            <span className="text-2xl font-bold text-gray-900">{data.bot_handled}</span>
          </div>
          <p className="text-sm text-gray-600">Bot Handled</p>
          <p className="text-xs text-gray-500 mt-1">{botPercentage}%</p>
        </div>

        <div className="bg-slate-50 rounded-lg p-4 border border-primary-200">
          <div className="flex items-center justify-between mb-2">
            <User className="w-6 h-6 text-primary-600" />
            <span className="text-2xl font-bold text-gray-900">{data.human_handled}</span>
          </div>
          <p className="text-sm text-gray-600">Human Handled</p>
          <p className="text-xs text-gray-500 mt-1">{humanPercentage}%</p>
        </div>

        <div className="bg-orange-50 rounded-lg p-4 border border-orange-200">
          <div className="flex items-center justify-between mb-2">
            <ArrowRightLeft className="w-6 h-6 text-orange-600" />
            <span className="text-2xl font-bold text-gray-900">{data.handoff_count}</span>
          </div>
          <p className="text-sm text-gray-600">Handoffs</p>
          <p className="text-xs text-gray-500 mt-1">Bot to Human</p>
        </div>
      </div>

      {/* Visual representation */}
      {total > 0 && (
        <div className="mt-4">
          <div className="flex gap-1 h-8 bg-gray-200 rounded overflow-hidden">
            <div
              className="bg-purple-500 flex items-center justify-center text-white text-xs font-semibold"
              style={{ width: `${botPercentage}%` }}
              title={`Bot: ${data.bot_handled} (${botPercentage}%)`}
            >
              {parseFloat(botPercentage) > 10 ? `${botPercentage}%` : ''}
            </div>
            <div
              className="bg-primary-500 flex items-center justify-center text-white text-xs font-semibold"
              style={{ width: `${humanPercentage}%` }}
              title={`Human: ${data.human_handled} (${humanPercentage}%)`}
            >
              {parseFloat(humanPercentage) > 10 ? `${humanPercentage}%` : ''}
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

