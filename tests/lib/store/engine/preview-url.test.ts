import { NextRequest } from 'next/server';
import { storePreviewUrl } from '@/lib/store/engine/preview-url';

const at = (url: string, headers: Record<string, string> = {}) => new NextRequest(url, { headers });

describe('storePreviewUrl', () => {
  it('uses https on staging even when the proxy says http (Cloudflare reaches nginx over plain http)', () => {
    const r = at('http://127.0.0.1:3001/api/x', { host: 'staging.khatario.com', 'x-forwarded-proto': 'http' });
    expect(storePreviewUrl(r, 'shop', '/', 't1', 'a b')).toBe(
      'https://shop.staging.khatario.com/?preview_theme=t1&pt=a%20b',
    );
  });

  it('uses https on production whatever the forwarded protocol', () => {
    const r = at('http://127.0.0.1:3000/api/x', { host: 'khatario.com' });
    expect(storePreviewUrl(r, 'shop', '/catalog', 't1', 'x')).toBe('https://shop.khatario.com/catalog?preview_theme=t1&pt=x');
  });

  it('keeps the request protocol and port on localhost', () => {
    const r = at('http://localhost:3015/api/x', { host: 'localhost:3015' });
    expect(storePreviewUrl(r, 'shop', '/', 't1', 'x')).toBe('http://shop.localhost:3015/?preview_theme=t1&pt=x');
  });
});
