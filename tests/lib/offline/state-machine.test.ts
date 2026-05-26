import {
  deriveConnectivityState,
  canQueueOfflineActions,
} from '@/lib/offline/connectivity/state-machine';

describe('connectivity state machine', () => {
  it('returns offline when browser offline', () => {
    expect(
      deriveConnectivityState({
        browserOnline: false,
        pendingActions: 0,
        isSyncing: false,
      })
    ).toBe('offline');
  });

  it('returns syncing when sync in progress', () => {
    expect(
      deriveConnectivityState({
        browserOnline: true,
        pendingActions: 3,
        isSyncing: true,
      })
    ).toBe('syncing');
  });

  it('returns degraded when online with pending queue', () => {
    expect(
      deriveConnectivityState({
        browserOnline: true,
        pendingActions: 2,
        isSyncing: false,
      })
    ).toBe('degraded');
  });

  it('allows queue when offline or degraded', () => {
    expect(canQueueOfflineActions('offline')).toBe(true);
    expect(canQueueOfflineActions('degraded')).toBe(true);
    expect(canQueueOfflineActions('online')).toBe(false);
  });
});
