/**
 * The theme demo stores' photos (public/theme-demos/**.webp) are static files on every host: a demo store host must
 * not rewrite them into its /store routes, and the app host must not send them to /login.
 */
jest.mock('@/lib/jwt', () => ({ shouldRotateTokens: jest.fn(async () => ({ rotate: false, payload: null })) }));
jest.mock('@/lib/platform-jwt', () => ({ getPlatformSessionFromRequest: jest.fn(async () => null) }));

import { NextRequest } from 'next/server';
import { middleware } from '../../middleware';

const served = (res: Response) => ({
  rewrite: res.headers.get('x-middleware-rewrite'),
  location: res.headers.get('location'),
  status: res.status,
});

describe('theme demo photos are static files', () => {
  it('on a demo store host the photo is served as is, not rewritten to /store', async () => {
    const req = new NextRequest('https://demo-heritage-couture.khatario.com/theme-demos/heroes/jewellery-1.webp', {
      headers: { host: 'demo-heritage-couture.khatario.com' },
    });
    expect(served(await middleware(req))).toEqual({ rewrite: null, location: null, status: 200 });
  });

  it('on the app host the photo is not sent to /login', async () => {
    const req = new NextRequest('https://khatario.com/theme-demos/jewellery/ring-gold.webp', { headers: { host: 'khatario.com' } });
    expect(served(await middleware(req))).toEqual({ rewrite: null, location: null, status: 200 });
  });
});
