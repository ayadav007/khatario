'use client';

import { Cloud, AlertCircle, Loader2 } from 'lucide-react';

export type SyncStatus = 'pending' | 'synced' | 'failed';

interface SyncStatusBadgeProps {
  status: SyncStatus;
  size?: 'sm' | 'md';
  showLabel?: boolean;
}

export function SyncStatusBadge({ status, size = 'sm', showLabel = true }: SyncStatusBadgeProps) {
  const sizeClass = size === 'sm' ? 'text-[10px] px-1.5 py-0.5' : 'text-xs px-2 py-1';
  const iconSize = size === 'sm' ? 'w-3 h-3' : 'w-4 h-4';

  if (status === 'synced') {
    return (
      <span
        className={`inline-flex items-center gap-1 rounded font-medium bg-green-50 text-green-700 border border-green-200 ${sizeClass}`}
        title="Synced"
      >
        <Cloud className={iconSize} />
        {showLabel && <span>Synced</span>}
      </span>
    );
  }

  if (status === 'pending') {
    return (
      <span
        className={`inline-flex items-center gap-1 rounded font-medium bg-amber-50 text-amber-700 border border-amber-200 ${sizeClass}`}
        title="Pending sync"
      >
        <Loader2 className={`${iconSize} animate-spin`} />
        {showLabel && <span>Pending</span>}
      </span>
    );
  }

  if (status === 'failed') {
    return (
      <span
        className={`inline-flex items-center gap-1 rounded font-medium bg-red-50 text-red-700 border border-red-200 ${sizeClass}`}
        title="Sync failed"
      >
        <AlertCircle className={iconSize} />
        {showLabel && <span>Failed</span>}
      </span>
    );
  }

  return null;
}
