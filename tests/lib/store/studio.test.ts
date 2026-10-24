import { sanitizeStoreTheme } from '@/lib/store/store-theme';
import { sanitizeStudioDraft } from '@/lib/store/studio-draft';
import { resolveStudioSections, studioLinkTarget, type StudioContext } from '@/lib/store/studio-layout';

const categories = [
  { id: 'c1', name: 'Fruits' },
  { id: 'c2', name: 'Dairy & Eggs' },
];

const ctx: StudioContext = {
  businessName: 'Shal Mart',
  tagline: 'Fresh every day',
  heroUrl: '',
  categories,
  autoAnnouncement: '',
};

describe('studioLinkTarget', () => {
  it('maps page labels to store routes', () => {
    expect(studioLinkTarget('About Us', categories)).toEqual({ kind: 'href', href: '/about' });
    expect(studioLinkTarget('  contact ', categories)).toEqual({ kind: 'href', href: '/contact' });
    expect(studioLinkTarget('/privacy', categories)).toEqual({ kind: 'href', href: '/privacy' });
    expect(studioLinkTarget('https://example.com/x', categories)).toEqual({ kind: 'href', href: 'https://example.com/x' });
  });

  it('maps offers and category names', () => {
    expect(studioLinkTarget('Sale', categories)).toEqual({ kind: 'offers' });
    expect(studioLinkTarget('dairy & eggs', categories)).toEqual({ kind: 'category', id: 'c2' });
  });

  it('falls back to the product list for anything else', () => {
    expect(studioLinkTarget('All Products', categories)).toEqual({ kind: 'products' });
    expect(studioLinkTarget('Bakery', categories)).toEqual({ kind: 'products' });
  });
});

describe('resolveStudioSections', () => {
  it('derives a layout for stores that never opened Studio', () => {
    const sections = resolveStudioSections(sanitizeStoreTheme({ pack: 'studio' }), ctx);
    expect(sections.map((s) => s.type)).toEqual([
      'announcement', 'header', 'hero', 'categories', 'products', 'banner', 'testimonials', 'footer',
    ]);
    const header = sections.find((s) => s.type === 'header');
    expect(header?.settings.navLinks).toContain('Fruits');
    expect(sections.find((s) => s.type === 'hero')?.settings.heading).toBe('Fresh every day');
  });

  it('uses the saved Studio layout when there is one', () => {
    const theme = sanitizeStoreTheme({
      pack: 'studio',
      studio_sections: [{ id: 'hero', type: 'hero', name: 'Hero', enabled: true, settings: { heading: 'Saved' } }],
    });
    const sections = resolveStudioSections(theme, ctx);
    expect(sections).toHaveLength(1);
    expect(sections[0].settings.heading).toBe('Saved');
  });
});

describe('sanitizeStudioDraft', () => {
  it('rejects non-object drafts', () => {
    expect(sanitizeStudioDraft(null)).toBeNull();
    expect(sanitizeStudioDraft([])).toBeNull();
    expect(sanitizeStudioDraft('x')).toBeNull();
  });

  it('normalises theme, pages and bounds', () => {
    const d = sanitizeStudioDraft({
      theme: { preset: 'custom', pack: 'aether', accent: '#123456' },
      sections: [{ id: 'hero', type: 'hero', name: 'Hero', enabled: true, settings: {} }, { junk: true }],
      pages: { mobileColumns: 5, minOrder: -40, allowCod: false, aboutMd: 'a'.repeat(30000), whatsappUrl: '' },
    });
    expect(d?.theme.pack).toBe('studio');
    expect(d?.theme.accent).toBe('#123456');
    expect(d?.sections.some((s) => s.type === 'hero')).toBe(true);
    expect(d?.pages.mobileColumns).toBe(2);
    expect(d?.pages.minOrder).toBe(0);
    expect(d?.pages.allowCod).toBe(false);
    expect(d?.pages.aboutMd).toHaveLength(20000);
    expect(d?.pages.whatsappUrl).toBe('');
  });
});
