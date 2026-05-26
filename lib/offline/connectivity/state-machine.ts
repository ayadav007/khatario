import type { ConnectivityState } from '@/lib/offline/types';
import { isAppOffline, isAppOnline } from '@/lib/network/offline-state';

export interface ConnectivitySnapshot {
  state: ConnectivityState;
  isOnline: boolean;
  isOffline: boolean;
  isSyncing: boolean;
  isDegraded: boolean;
  lastChangedAt: number | null;
}

export interface ConnectivityTransitionInput {
  browserOnline: boolean;
  pendingActions: number;
  isSyncing: boolean;
  probeFailed?: boolean;
}

/**
 * Derives UX connectivity state from network + queue + sync activity.
 */
export function deriveConnectivityState(
  input: ConnectivityTransitionInput
): ConnectivityState {
  if (input.isSyncing) return 'syncing';

  if (!input.browserOnline) return 'offline';

  if (input.probeFailed || input.pendingActions > 0) {
    return input.browserOnline ? 'degraded' : 'offline';
  }

  if (input.browserOnline && isAppOnline()) return 'online';

  return input.browserOnline ? 'degraded' : 'offline';
}

export function buildConnectivitySnapshot(
  state: ConnectivityState,
  lastChangedAt: number | null
): ConnectivitySnapshot {
  return {
    state,
    isOnline: state === 'online' || state === 'degraded' || state === 'syncing',
    isOffline: state === 'offline',
    isSyncing: state === 'syncing',
    isDegraded: state === 'degraded',
    lastChangedAt,
  };
}

export function connectivityLabel(state: ConnectivityState): string {
  switch (state) {
    case 'online':
      return 'Online';
    case 'degraded':
      return 'Limited connectivity';
    case 'offline':
      return 'Offline';
    case 'reconnecting':
      return 'Reconnecting…';
    case 'syncing':
      return 'Syncing…';
    default:
      return 'Unknown';
  }
}

/** Guard for write paths — allow optimistic queue when offline. */
export function canQueueOfflineActions(state: ConnectivityState): boolean {
  return state === 'offline' || state === 'degraded';
}

export function shouldRunBackgroundSync(state: ConnectivityState): boolean {
  return (
    (state === 'online' || state === 'degraded' || state === 'reconnecting') &&
    !isAppOffline()
  );
}
