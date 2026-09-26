import { resolvePublicRequestOrigin } from '@/lib/http/public-request-origin';

describe('resolvePublicRequestOrigin', () => {
  it('uses forwarded host when nginx sits in front of 127.0.0.1', () => {
    const origin = resolvePublicRequestOrigin({
      headers: {
        get(name: string) {
          if (name === 'x-forwarded-host') return 'khatario.com';
          if (name === 'x-forwarded-proto') return 'https';
          if (name === 'host') return '127.0.0.1:3100';
          return null;
        },
      },
      nextUrl: { origin: 'http://127.0.0.1:3100', protocol: 'http:' },
    });
    expect(origin).toBe('https://khatario.com');
  });

  it('falls back to NEXT_PUBLIC_APP_URL in production when host is localhost', () => {
    const prevUrl = process.env.NEXT_PUBLIC_APP_URL;
    const prevEnv = process.env.NODE_ENV;
    process.env.NEXT_PUBLIC_APP_URL = 'https://khatario.com';
    process.env.NODE_ENV = 'production';
    try {
      const origin = resolvePublicRequestOrigin({
        headers: {
          get(name: string) {
            if (name === 'host') return 'localhost:3100';
            return null;
          },
        },
        nextUrl: { origin: 'https://localhost:3100', protocol: 'https:' },
      });
      expect(origin).toBe('https://khatario.com');
    } finally {
      process.env.NEXT_PUBLIC_APP_URL = prevUrl;
      process.env.NODE_ENV = prevEnv;
    }
  });
});
