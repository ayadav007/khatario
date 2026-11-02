import { upgradeRequestFromResponse, upgradeRequestKey } from '@/lib/upgrade/upgrade-request';

describe('upgradeRequestFromResponse', () => {
  it('turns a plan denial on a write into a feature request', () => {
    expect(upgradeRequestFromResponse('POST', 403, { code: 'FEATURE_NOT_IN_PLAN', feature: 'eway_bill' })).toEqual({
      variant: 'feature',
      featureKey: 'eway_bill',
    });
  });

  it('accepts the legacy denial code', () => {
    expect(upgradeRequestFromResponse('put', 403, { code: 'FEATURE_NOT_AVAILABLE', feature: 'eway_bill' })).toEqual({
      variant: 'feature',
      featureKey: 'eway_bill',
    });
  });

  it('sends WhatsApp inbox denials to the Connect add-on', () => {
    expect(upgradeRequestFromResponse('POST', 403, { code: 'FEATURE_NOT_IN_PLAN', feature: 'integration_whatsapp_bot' })).toEqual({
      variant: 'addon',
      featureKey: 'integration_whatsapp_bot',
      moduleKey: 'connect',
      initialPlanId: 'connect',
    });
  });

  it('turns a limit reply into a limit request', () => {
    expect(
      upgradeRequestFromResponse('POST', 403, {
        code: 'SUBSCRIPTION_LIMIT_EXCEEDED',
        limit_type: 'estimates',
        limit: 20,
        current: 20,
      }),
    ).toEqual({ variant: 'limit', limitType: 'estimates', limit: 20, current: 20 });
  });

  it('keeps a limit reply without limit_type', () => {
    expect(upgradeRequestFromResponse('PATCH', 403, { code: 'SUBSCRIPTION_LIMIT_EXCEEDED', limit: 1, current: 1 })).toEqual({
      variant: 'limit',
      limit: 1,
      current: 1,
    });
  });

  it('ignores reads, other statuses and other codes', () => {
    expect(upgradeRequestFromResponse('GET', 403, { code: 'FEATURE_NOT_IN_PLAN', feature: 'eway_bill' })).toBeNull();
    expect(upgradeRequestFromResponse('GET', 403, { code: 'SUBSCRIPTION_LIMIT_EXCEEDED' })).toBeNull();
    expect(upgradeRequestFromResponse('POST', 400, { code: 'FEATURE_NOT_IN_PLAN' })).toBeNull();
    expect(upgradeRequestFromResponse('POST', 403, { code: 'PERMISSION_DENIED' })).toBeNull();
    expect(upgradeRequestFromResponse('POST', 403, null)).toBeNull();
  });
});

describe('upgradeRequestKey', () => {
  it('keys by variant and feature or limit', () => {
    expect(upgradeRequestKey({ variant: 'feature', featureKey: 'eway_bill' })).toBe('feature:eway_bill');
    expect(upgradeRequestKey({ variant: 'limit', limitType: 'users' })).toBe('limit:users');
    expect(upgradeRequestKey({ variant: 'trial' })).toBe('trial:');
  });
});
