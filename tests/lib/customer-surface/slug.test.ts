import {
  isReservedBusinessSlug,
  slugifyPortalSegment,
  validatePortalSlugFormat,
} from '@/lib/customer-surface/slug';

describe('portal slug validation', () => {
  it('slugifies business names', () => {
    expect(slugifyPortalSegment('Acme Corp Pvt Ltd')).toBe('acme-corp-pvt-ltd');
  });

  it('accepts valid custom slugs', () => {
    expect(validatePortalSlugFormat('acme-mumbai')).toEqual({ ok: true, slug: 'acme-mumbai' });
  });

  it('rejects reserved slugs', () => {
    const result = validatePortalSlugFormat('login');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/reserved/i);
    }
    expect(isReservedBusinessSlug('login')).toBe(true);
  });

  it('rejects too-short slugs', () => {
    const result = validatePortalSlugFormat('ab');
    expect(result.ok).toBe(false);
  });
});
