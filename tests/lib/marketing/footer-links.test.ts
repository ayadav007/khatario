import { FOOTER_COLUMNS, FOOTER_LEGAL_LINKS } from '@/lib/marketing/footer-links';
import { MARKETING_STATIC_PATHS } from '@/lib/marketing/static-paths';

const OTHER_REAL_PAGES = ['/login', '/signup', '/partners']; // exist, deliberately not in the sitemap list
const all = [...FOOTER_COLUMNS.flatMap((c) => c.links), ...FOOTER_LEGAL_LINKS];

describe('footer links', () => {
  it('links only to pages that exist', () => {
    for (const l of all) {
      const pathOnly = l.href.split(/[?#]/)[0] || '/';
      expect([...MARKETING_STATIC_PATHS, ...OTHER_REAL_PAGES]).toContain(pathOnly);
    }
  });
  it('carries the trust pages', () => {
    const hrefs = all.map((l) => l.href);
    for (const p of ['/contact', '/pricing', '/refund-policy', '/security', '/privacy', '/terms']) {
      expect(hrefs).toContain(p);
    }
    expect(hrefs).not.toContain('/#pricing');
  });
  it('orders the legal row', () => {
    expect(FOOTER_LEGAL_LINKS).toEqual([
      { label: 'Privacy', href: '/privacy' },
      { label: 'Terms', href: '/terms' },
      { label: 'Refund policy', href: '/refund-policy' },
      { label: 'Security', href: '/security' },
    ]);
  });
  it('has no duplicate labels inside a column', () => {
    for (const c of FOOTER_COLUMNS) {
      expect(new Set(c.links.map((l) => l.label)).size).toBe(c.links.length);
    }
  });
});
