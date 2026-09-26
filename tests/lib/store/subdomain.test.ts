import {
  extractStoreSubdomain,
  storeHostSuffix,
  storePublicHostname,
} from '@/lib/store/subdomain';

describe('extractStoreSubdomain', () => {
  it('reads a staging store host', () => {
    expect(extractStoreSubdomain('shalinitraders.staging.khatario.com')).toBe('shalinitraders');
  });

  it('reads a production store host', () => {
    expect(extractStoreSubdomain('shalinitraders.khatario.com')).toBe('shalinitraders');
  });

  it('ignores the main app hosts', () => {
    expect(extractStoreSubdomain('staging.khatario.com')).toBeNull();
    expect(extractStoreSubdomain('app.khatario.com')).toBeNull();
    expect(extractStoreSubdomain('khatario.com')).toBeNull();
    expect(extractStoreSubdomain('www.khatario.com')).toBeNull();
  });

  it('reads a local store host', () => {
    expect(extractStoreSubdomain('shalinitraders.localhost:3000')).toBe('shalinitraders');
  });

  it('reads theme demo hosts on localhost', () => {
    expect(extractStoreSubdomain('theme-khatario.localhost:3001')).toBe('theme-khatario');
    expect(extractStoreSubdomain('theme-noir.localhost:3001')).toBe('theme-noir');
  });
});

describe('storePublicHostname', () => {
  it('uses the staging suffix when the app is opened on staging', () => {
    expect(storeHostSuffix('staging.khatario.com')).toBe('.staging.khatario.com');
    expect(storePublicHostname('shalinitraders', 'staging.khatario.com')).toBe(
      'shalinitraders.staging.khatario.com',
    );
  });

  it('uses the production suffix on the production app host', () => {
    expect(storePublicHostname('shalinitraders', 'app.khatario.com')).toBe(
      'shalinitraders.khatario.com',
    );
  });
});
