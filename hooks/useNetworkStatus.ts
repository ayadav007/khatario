'use client';

import { useNetworkStatusContext } from '@/contexts/NetworkStatusContext';

export interface NetworkStatus {
  isOnline: boolean;
  isOffline: boolean;
  lastChangedAt?: number;
}

/**
 * Global connectivity state (browser events + Capacitor Network on native).
 */
export function useNetworkStatus(): NetworkStatus {
  return useNetworkStatusContext();
}
