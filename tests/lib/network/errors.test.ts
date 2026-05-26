import {
  isLikelyNetworkFetchError,
  shouldSuppressOfflineToast,
} from '@/lib/network/errors';
import { setAppOnlineState } from '@/lib/network/offline-state';

describe('network errors', () => {
  afterEach(() => {
    setAppOnlineState(true);
  });

  it('detects Failed to fetch TypeError', () => {
    expect(isLikelyNetworkFetchError(new TypeError('Failed to fetch'))).toBe(true);
  });

  it('suppresses toasts when app is offline', () => {
    setAppOnlineState(false);
    expect(shouldSuppressOfflineToast('Something went wrong')).toBe(true);
  });

  it('suppresses network-shaped toast messages when online', () => {
    setAppOnlineState(true);
    expect(shouldSuppressOfflineToast('Network error loading report')).toBe(true);
  });

  it('allows normal errors when online', () => {
    setAppOnlineState(true);
    expect(shouldSuppressOfflineToast('Invalid GSTIN')).toBe(false);
  });
});
