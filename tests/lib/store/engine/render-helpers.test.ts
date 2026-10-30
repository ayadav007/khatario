import { catalogHref, ctaTarget } from '@/lib/store/engine/links';
import {
  engineCategoryStyle,
  engineRootStyle,
  pickCategories,
  sectionFrameClass,
  sectionFrameStyle,
} from '@/lib/store/engine/render-helpers';
import { DEFAULT_COLOR_SCHEMES } from '@/lib/store/engine/color-schemes';
import type { Section, ThemeSettings } from '@/lib/store/engine/types';

const settings: ThemeSettings = {
  color_schemes: DEFAULT_COLOR_SCHEMES,
  font_heading: 'outfit',
  font_body: 'inter',
  button_radius: 10,
  card_style: 'bordered',
  phone_kit: true,
  logo_url: '',
  favicon_url: '',
  custom_css: '',
  social: { instagram: '', whatsapp: '', facebook: '', youtube: '' },
};

function sec(over: Partial<Section> = {}): Section {
  return { type: 'rich-text', settings: {}, blocks: {}, block_order: [], ...over };
}

describe('catalogHref', () => {
  it('keeps preview and draft params and sets cat', () => {
    expect(catalogHref('?preview_theme=abc&pt=tok&td=d&cat=old&q=x&other=1', { cat: 'c1' })).toBe(
      '/?preview_theme=abc&pt=tok&td=d&cat=c1',
    );
  });

  it('keeps editor only alongside a theme preview', () => {
    expect(catalogHref('?preview_theme=abc&pt=tok&editor=1', { q: 'rice' })).toBe('/?preview_theme=abc&pt=tok&editor=1&q=rice');
    expect(catalogHref('?editor=1', { q: 'rice' })).toBe('/?q=rice');
    expect(catalogHref('?preview_theme=abc&editor=1', {})).toBe('/?preview_theme=abc');
    expect(catalogHref('?pt=tok&editor=1', {})).toBe('/?pt=tok');
  });

  it('sets q and drops empty values', () => {
    expect(catalogHref('', { q: 'rice dal', cat: '' })).toBe('/?q=rice+dal');
  });

  it('returns / when nothing is kept', () => {
    expect(catalogHref('?cat=a&q=b', {})).toBe('/');
  });

  it('appends a hash', () => {
    expect(catalogHref('?pt=t', { cat: 'c' }, 'catalog')).toBe('/?pt=t&cat=c#catalog');
    expect(catalogHref('', {}, 'catalog')).toBe('/#catalog');
  });
});

describe('ctaTarget', () => {
  it('classifies anchors, internal and external links', () => {
    expect(ctaTarget('#catalog')).toEqual({ kind: 'anchor', id: 'catalog' });
    expect(ctaTarget('/contact')).toEqual({ kind: 'internal', href: '/contact' });
    expect(ctaTarget('/#catalog')).toEqual({ kind: 'internal', href: '/#catalog' });
    expect(ctaTarget('https://example.com/x')).toEqual({ kind: 'external', href: 'https://example.com/x' });
  });

  it('rejects anything else', () => {
    expect(ctaTarget('')).toEqual({ kind: 'none' });
    expect(ctaTarget('#')).toEqual({ kind: 'none' });
    expect(ctaTarget('//evil.com')).toEqual({ kind: 'none' });
    expect(ctaTarget('javascript:alert(1)')).toEqual({ kind: 'none' });
    expect(ctaTarget('http://example.com')).toEqual({ kind: 'none' });
    expect(ctaTarget('/\t/evil.com')).toEqual({ kind: 'none' });
    expect(ctaTarget(42)).toEqual({ kind: 'none' });
  });
});

describe('engineRootStyle', () => {
  it('sets scheme 1 vars, studio vars and fonts', () => {
    const s = engineRootStyle(settings);
    expect(s['--c-bg']).toBe('#ffffff');
    expect(s['--primary']).toBe('#2563eb');
    expect(s['--paper']).toBe('#ffffff');
    expect(s['--text']).toBe('#111827');
    expect(s['--font-heading']).toContain('--font-store-outfit');
    expect(s['--font-body']).toContain('--font-khatario-ui');
    expect(s.fontFamily).toBe(s['--font-body']);
    expect(s['--btn-radius']).toBe('10px');
    expect(s.backgroundColor).toBe('#ffffff');
  });
});

describe('sectionFrameStyle', () => {
  it('uses scheme 1 vars without repainting when the section has no scheme', () => {
    const s = sectionFrameStyle(settings, sec());
    expect(s['--c-bg']).toBe('#ffffff');
    expect(s.background).toBeUndefined();
    expect(s['--paper']).toBeUndefined();
  });

  it('applies a chosen scheme as vars and paint, without moving --primary', () => {
    const s = sectionFrameStyle(settings, sec({ color_scheme: 'scheme-3' }));
    expect(s['--c-bg']).toBe('#111827');
    expect(s['--c-text']).toBe('#f9fafb');
    expect(s['--primary']).toBeUndefined();
    expect(s['--paper']).toBe('#111827');
    expect(s['--text']).toBe('#f9fafb');
    expect(s['--st-card']).toBe('#1f2937');
    expect(s.background).toBe('#111827');
    expect(s.color).toBe('#f9fafb');
  });

  it('falls back to scheme 1 for an unknown scheme', () => {
    const s = sectionFrameStyle(settings, sec({ color_scheme: 'nope' }));
    expect(s['--c-bg']).toBe('#ffffff');
    expect(s.background).toBeUndefined();
  });

  it('adds spacing from the section settings and schema defaults', () => {
    expect(sectionFrameStyle(settings, sec()).paddingTop).toBe(32);
    const s = sectionFrameStyle(settings, sec({ settings: { spacing_top: 0, spacing_bottom: 48 } }));
    expect(s.paddingTop).toBe(0);
    expect(s.paddingBottom).toBe(48);
    expect(sectionFrameStyle(settings, sec({ type: 'header' })).paddingTop).toBeUndefined();
  });
});

describe('pickCategories', () => {
  const all = [
    { id: 'a', name: 'A', item_count: 1, image_url: null },
    { id: 'b', name: 'B', item_count: 2, image_url: null },
    { id: 'c', name: 'C', item_count: 3, image_url: null },
  ];
  it('returns all when none picked', () => {
    expect(pickCategories(all, [])).toEqual(all);
    expect(pickCategories(all, undefined)).toEqual(all);
  });
  it('keeps picked order and skips missing ids', () => {
    expect(pickCategories(all, ['c', 'x', 'a']).map((c) => c.id)).toEqual(['c', 'a']);
  });
});

describe('engineCategoryStyle', () => {
  it('uses photos when any category has an image', () => {
    expect(engineCategoryStyle('tiles', true)).toBe('photo');
    expect(engineCategoryStyle('cards', false)).toBe('icon');
    expect(engineCategoryStyle('tiles', false)).toBe('letter');
    expect(engineCategoryStyle('circles', false)).toBe('letter');
  });
});

describe('sectionFrameClass', () => {
  it('adds the full-width modifier only when full_width is true', () => {
    expect(sectionFrameClass({ full_width: true })).toBe('eng-sec eng-sec--full');
    expect(sectionFrameClass({ full_width: false })).toBe('eng-sec');
    expect(sectionFrameClass({ full_width: 'true' })).toBe('eng-sec');
    expect(sectionFrameClass({})).toBe('eng-sec');
  });
});
