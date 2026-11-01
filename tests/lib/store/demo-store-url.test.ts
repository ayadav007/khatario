import { demoStoreUrl } from '@/lib/store/demo-store-url';

describe('demoStoreUrl', () => {
  it('uses https on khatario.com and its staging host, whatever the proxy says', () => {
    expect(demoStoreUrl('khatario.com', 'http', 'demo-quick', '/', true)).toBe('https://demo-quick.khatario.com/?embed=1');
    expect(demoStoreUrl('www.khatario.com', 'https', 'demo-quick', '/', false)).toBe('https://demo-quick.khatario.com/');
    expect(demoStoreUrl('staging.khatario.com', 'https', 'demo-quick', '/catalog', false)).toBe(
      'https://demo-quick.staging.khatario.com/catalog',
    );
    expect(demoStoreUrl('staging.khatario.com', 'http', 'demo-quick', '/products/gr-1', true)).toBe(
      'https://demo-quick.staging.khatario.com/products/gr-1?embed=1',
    );
  });

  it('keeps the protocol and port on localhost', () => {
    expect(demoStoreUrl('app.localhost:3000', 'http', 'demo-quick', '/', true)).toBe('http://demo-quick.localhost:3000/?embed=1');
    expect(demoStoreUrl('localhost:3015', 'http', 'demo-quick', '/catalog', false)).toBe('http://demo-quick.localhost:3015/catalog');
  });
});
