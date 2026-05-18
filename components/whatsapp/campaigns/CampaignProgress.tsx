'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { Loader2, CheckCircle2, XCircle, Clock, TrendingUp, Users } from 'lucide-react';

interface CampaignProgressProps {
  campaignId: string;
  autoRefresh?: boolean;
  refreshInterval?: number; // in milliseconds, default 5000 (5 seconds)
  onStatusChange?: (status: string) => void;
  compact?: boolean;
}

interface CampaignStats {
  status: 'draft' | 'running' | 'paused' | 'completed' | 'failed';
  total_recipients: number;
  sent_count: number;
  failed_count: number;
  pending_count: number;
  last_sent_at?: string;
}

export function CampaignProgress({ 
  campaignId, 
  autoRefresh = true, 
  refreshInterval = 15000, // Increased from 5000ms (5s) to 15000ms (15s) for better performance
  onStatusChange,
  compact = false 
}: CampaignProgressProps) {
  const [stats, setStats] = useState<CampaignStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchStats = useCallback(async () => {
    if (!campaignId) return;
    
    try {
      const res = await fetch(`/api/whatsapp/campaigns/${campaignId}`);
      const data = await res.json();
      
      if (data.error) {
        setError(data.error);
        setLoading(false);
        return;
      }

      const campaign = data.campaign;
      const newStats: CampaignStats = {
        status: campaign.status,
        total_recipients: campaign.total_recipients || 0,
        sent_count: campaign.sent_count || 0,
        failed_count: campaign.failed_count || 0,
        pending_count: campaign.pending_count || 0,
        last_sent_at: campaign.last_sent_at,
      };

      // Notify parent of status change
      if (stats && stats.status !== newStats.status && onStatusChange) {
        onStatusChange(newStats.status);
      }

      setStats(newStats);
      setLastUpdated(new Date());
      setError(null);
      setLoading(false);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch campaign stats');
      setLoading(false);
    }
  }, [campaignId, onStatusChange, stats]);

  useEffect(() => {
    if (!campaignId) return;
    
    // Initial fetch
    fetchStats();

    // Set up auto-refresh if enabled
    if (autoRefresh) {
      const interval = setInterval(() => {
        fetchStats();
      }, refreshInterval);

      return () => clearInterval(interval);
    }
  }, [campaignId, autoRefresh, refreshInterval, fetchStats]);

  if (loading && !stats) {
    return (
      <Card padding={compact ? 'md' : 'lg'}>
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
          <span className="ml-3 text-gray-600">Loading campaign progress...</span>
        </div>
      </Card>
    );
  }

  if (error) {
    return (
      <Card padding={compact ? 'md' : 'lg'}>
        <div className="text-center py-4">
          <p className="text-red-600 text-sm">{error}</p>
          <button
            onClick={fetchStats}
            className="mt-2 text-primary-600 hover:text-primary-700 text-sm font-medium"
          >
            Retry
          </button>
        </div>
      </Card>
    );
  }

  if (!stats) {
    return null;
  }

  const completedCount = stats.sent_count + stats.failed_count;
  const progressPercentage = stats.total_recipients > 0
    ? Math.round((completedCount / stats.total_recipients) * 100)
    : 0;
  
  const successRate = stats.total_recipients > 0
    ? Math.round(((stats.sent_count - stats.failed_count) / stats.total_recipients) * 100)
    : 0;

  if (compact) {
    return (
      <Card padding="md">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <Chip
              variant={
                stats.status === 'running' ? 'success' :
                stats.status === 'completed' ? 'default' :
                stats.status === 'paused' ? 'warning' :
                stats.status === 'failed' ? 'error' : 'default'
              }
              className="text-xs capitalize"
            >
              {stats.status}
            </Chip>
            {autoRefresh && stats.status === 'running' && (
              <div className="flex items-center gap-1 text-xs text-gray-500">
                <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                <span>Live</span>
              </div>
            )}
          </div>
          {lastUpdated && (
            <span className="text-xs text-gray-500">
              Updated {lastUpdated.toLocaleTimeString()}
            </span>
          )}
        </div>
        
        <div className="mb-3">
          <div className="flex items-center justify-between text-sm mb-1">
            <span className="text-gray-600">Progress</span>
            <span className="font-medium">{progressPercentage}%</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div
              className="bg-primary-600 h-2 rounded-full transition-all duration-500"
              style={{ width: `${progressPercentage}%` }}
            />
          </div>
        </div>

        <div className="grid grid-cols-4 gap-3 text-center">
          <div>
            <div className="text-lg font-bold text-gray-900">{stats.total_recipients}</div>
            <div className="text-xs text-gray-600">Total</div>
          </div>
          <div>
            <div className="text-lg font-bold text-green-600">{stats.sent_count}</div>
            <div className="text-xs text-gray-600">Sent</div>
          </div>
          <div>
            <div className="text-lg font-bold text-red-600">{stats.failed_count}</div>
            <div className="text-xs text-gray-600">Failed</div>
          </div>
          <div>
            <div className="text-lg font-bold text-gray-600">{stats.pending_count}</div>
            <div className="text-xs text-gray-600">Pending</div>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card padding="lg">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Campaign Progress</h3>
          {lastUpdated && (
            <p className="text-xs text-gray-500 mt-1">
              Last updated: {lastUpdated.toLocaleTimeString()}
            </p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <Chip
            variant={
              stats.status === 'running' ? 'success' :
              stats.status === 'completed' ? 'default' :
              stats.status === 'paused' ? 'warning' :
              stats.status === 'failed' ? 'error' : 'default'
            }
            className="capitalize"
          >
            {stats.status}
          </Chip>
          {autoRefresh && stats.status === 'running' && (
            <div className="flex items-center gap-2 text-sm text-green-600">
              <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
              <span>Live Updates</span>
            </div>
          )}
        </div>
      </div>

      {/* Progress Bar */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-gray-700">Overall Progress</span>
          <span className="text-sm font-medium text-gray-900">
            {completedCount} / {stats.total_recipients} ({progressPercentage}%)
          </span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-3">
          <div
            className="bg-primary-600 h-3 rounded-full transition-all duration-500"
            style={{ width: `${progressPercentage}%` }}
          />
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-gray-50 rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-gray-600">Total Recipients</span>
            <Users className="w-5 h-5 text-primary-600" />
          </div>
          <div className="text-2xl font-bold text-gray-900">{stats.total_recipients}</div>
        </div>

        <div className="bg-green-50 rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-gray-600">Sent</span>
            <CheckCircle2 className="w-5 h-5 text-green-600" />
          </div>
          <div className="text-2xl font-bold text-green-600">{stats.sent_count}</div>
        </div>

        <div className="bg-red-50 rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-gray-600">Failed</span>
            <XCircle className="w-5 h-5 text-red-600" />
          </div>
          <div className="text-2xl font-bold text-red-600">{stats.failed_count}</div>
        </div>

        <div className="bg-slate-50 rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-gray-600">Success Rate</span>
            <TrendingUp className="w-5 h-5 text-primary-600" />
          </div>
          <div className="text-2xl font-bold text-primary-600">{successRate}%</div>
        </div>
      </div>

      {/* Status Breakdown */}
      <div className="border-t border-gray-200 pt-4">
        <div className="flex items-center justify-between text-sm">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-green-500"></div>
              <span className="text-gray-600">Sent: {stats.sent_count}</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-red-500"></div>
              <span className="text-gray-600">Failed: {stats.failed_count}</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-gray-400"></div>
              <span className="text-gray-600">Pending: {stats.pending_count}</span>
            </div>
          </div>
          {stats.last_sent_at && (
            <div className="flex items-center gap-2 text-gray-500">
              <Clock className="w-4 h-4" />
              <span>Last sent: {new Date(stats.last_sent_at).toLocaleTimeString()}</span>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

