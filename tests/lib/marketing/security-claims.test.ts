import fs from 'fs';
import path from 'path';
import { SECURITY_CLAIMS } from '@/lib/marketing/security-claims';

describe('SECURITY_CLAIMS', () => {
  it('has between four and eight claims with unique ids', () => {
    expect(SECURITY_CLAIMS.length).toBeGreaterThanOrEqual(4);
    expect(SECURITY_CLAIMS.length).toBeLessThanOrEqual(8);
    expect(new Set(SECURITY_CLAIMS.map((c) => c.id)).size).toBe(SECURITY_CLAIMS.length);
  });

  it('backs every claim with a file that exists', () => {
    for (const c of SECURITY_CLAIMS)
      for (const p of c.evidence.split(',').map((s) => s.trim()))
        expect(fs.existsSync(path.join(process.cwd(), p))).toBe(true);
  });

  it('makes no certification or absolute claim', () => {
    for (const c of SECURITY_CLAIMS) {
      const text = `${c.title} ${c.body}`;
      expect(text).not.toMatch(/ISO|SOC ?2|bank[- ]grade|military|100%|unhackable|guaranteed|never be (lost|hacked)|—/i);
      expect(text.trim().length).toBeGreaterThan(20);
    }
  });
});
