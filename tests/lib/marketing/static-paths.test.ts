import fs from 'fs';
import path from 'path';
import { MARKETING_STATIC_PATHS } from '@/lib/marketing/static-paths';

describe('marketing static paths', () => {
  it('lists the four trust pages and keeps the old ones', () => {
    for (const p of ['/contact', '/pricing', '/refund-policy', '/security', '/privacy', '/terms', '/about', '/'])
      expect(MARKETING_STATIC_PATHS).toContain(p);
    expect(new Set(MARKETING_STATIC_PATHS).size).toBe(MARKETING_STATIC_PATHS.length);
  });
  it('lists the free tools hub', () => expect(MARKETING_STATIC_PATHS).toContain('/free-tools'));
  it('has a page file for every path', () => {
    for (const p of MARKETING_STATIC_PATHS)
      expect(fs.existsSync(path.join(process.cwd(), 'app', p, 'page.tsx'))).toBe(true);
  });
});
