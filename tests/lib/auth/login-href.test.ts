import { loginHrefFor } from '@/lib/auth/login-href';

describe('loginHrefFor', () => {
  it('passes a same-site return path on to login, so an existing user who chose Log in lands back where they started', () => {
    expect(loginHrefFor('/settings/online-store/themes/apply/heritage-couture')).toBe(
      '/login?redirect=%2Fsettings%2Fonline-store%2Fthemes%2Fapply%2Fheritage-couture',
    );
  });

  it('is plain /login without a return path, for the dashboard default, or for anything off-site', () => {
    expect(loginHrefFor(null)).toBe('/login');
    expect(loginHrefFor('/dashboard')).toBe('/login');
    expect(loginHrefFor('//evil.com')).toBe('/login');
    expect(loginHrefFor('https://evil.com')).toBe('/login');
    expect(loginHrefFor(String.raw`/\evil.com`)).toBe('/login');
  });
});
