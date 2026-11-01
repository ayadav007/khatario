import { describe, expect, it } from '@jest/globals';
import { localNotificationId, planPushTap, safeSitePath } from '@/lib/push/client/tap-route';

const BIZ = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';

describe('push tap routing', () => {
  it('follows the server path for the current business', () => {
    expect(planPushTap({ href: '/invoices/abc', business_id: BIZ }, { audience: 'business', currentBusinessId: BIZ })).toEqual({
      href: '/invoices/abc',
      switchBusinessId: null,
    });
  });

  it('asks for a business switch when the notification belongs to another business', () => {
    expect(planPushTap({ href: '/supply-orders/x', business_id: OTHER }, { audience: 'business', currentBusinessId: BIZ })).toEqual({
      href: '/supply-orders/x',
      switchBusinessId: OTHER,
    });
  });

  it('falls back to the notifications list (business) or the store account (customer)', () => {
    expect(planPushTap({}, { audience: 'business', currentBusinessId: BIZ }).href).toBe('/notifications');
    expect(planPushTap(null, { audience: 'customer' }).href).toBe('/account');
    expect(planPushTap({ href: '/khata', business_id: OTHER }, { audience: 'customer' })).toEqual({ href: '/khata', switchBusinessId: null });
  });

  it('never leaves the origin, whatever the payload says', () => {
    expect(safeSitePath('https://evil.example/')).toBeNull();
    expect(safeSitePath('//evil.example/x')).toBeNull();
    expect(safeSitePath('javascript:alert(1)')).toBeNull();
    expect(safeSitePath('/ok?x=1#y')).toBe('/ok?x=1#y');
    expect(planPushTap({ href: 'https://evil.example/' }, { audience: 'business' }).href).toBe('/notifications');
    expect(planPushTap({ href: '/x', business_id: 'not-a-uuid' }, { audience: 'business', currentBusinessId: BIZ }).switchBusinessId).toBeNull();
  });

  it('gives the same local id for the same notification', () => {
    const a = localNotificationId({ notification_id: 'n-1' });
    expect(a).toBe(localNotificationId({ notification_id: 'n-1' }));
    expect(a).toBeGreaterThan(0);
    expect(localNotificationId({ job_id: 'j-2' })).not.toBe(a);
  });
});
