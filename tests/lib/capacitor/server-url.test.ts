import {
  resolveCapacitorServerUrl,
  resolveOfflineBootstrapUrl,
  OFFLINE_BOOTSTRAP_PARAM,
} from '@/lib/capacitor/server-url';

describe('resolveCapacitorServerUrl', () => {
  it('appends /login to origin-only URLs', () => {
    expect(resolveCapacitorServerUrl('https://staging.khatario.com')).toBe(
      'https://staging.khatario.com/login'
    );
  });
});

describe('resolveOfflineBootstrapUrl', () => {
  it('targets cached dashboard with bootstrap query param', () => {
    expect(resolveOfflineBootstrapUrl('https://staging.khatario.com')).toBe(
      `https://staging.khatario.com/dashboard?${OFFLINE_BOOTSTRAP_PARAM}=1`
    );
  });
});
