import { isOfflineCapable, isOfflineBlockedHref } from '@/lib/offline/offline-capable-routes';

describe('offline-capable-routes', () => {
  it('allows cached bottom-nav routes', () => {
    expect(isOfflineCapable('/dashboard')).toBe(true);
    expect(isOfflineCapable('/items')).toBe(true);
    expect(isOfflineCapable('/customers')).toBe(true);
    expect(isOfflineCapable('/invoices')).toBe(true);
    expect(isOfflineCapable('/more')).toBe(true);
  });

  it('blocks uncached routes', () => {
    expect(isOfflineCapable('/reports')).toBe(false);
    expect(isOfflineCapable('/settings')).toBe(false);
    expect(isOfflineBlockedHref('/reports')).toBe(true);
  });

  it('allows invoice create and item detail prefixes', () => {
    expect(isOfflineCapable('/invoices/new')).toBe(true);
    expect(isOfflineCapable('/items/abc-123')).toBe(true);
    expect(isOfflineCapable('/customers/abc-123')).toBe(true);
  });
});
