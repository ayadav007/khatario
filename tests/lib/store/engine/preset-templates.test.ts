import { defaultTemplate, PAGE_STARTERS } from '@/lib/store/engine/presets/templates';
import { studioPreset } from '@/lib/store/engine/presets/studio';
import { blankPreset } from '@/lib/store/engine/presets/blank';
import { sanitizeThemeData } from '@/lib/store/engine/sanitize';
import type { Template } from '@/lib/store/engine/types';

const ctx = { businessName: 'Shop', tagline: 'Hello', accent: '#2563eb', logoUrl: null, heroUrl: null } as never;

function survives(key: 'product' | 'catalog' | 'page', t: Template) {
  const name = key === 'page' ? 'page.x' : key;
  const out = sanitizeThemeData({ templates: { [name]: t } }).templates[name];
  return out ? out.order.length : 0;
}

describe('preset templates', () => {
  it('the default product template survives sanitising with every section', () => {
    const t = defaultTemplate('product');
    expect(t.order.map((id) => t.sections[id].type)).toEqual([
      'main-product',
      'product-reviews',
      'related-products',
      'recently-viewed',
    ]);
    expect(survives('product', t)).toBe(4);
  });

  it('the default catalog template is a banner then the product grid, and survives sanitising', () => {
    const t = defaultTemplate('catalog');
    expect(t.order.map((id) => t.sections[id].type)).toEqual(['catalog-banner', 'main-catalog']);
    expect(survives('catalog', t)).toBe(2);
  });

  it.each(Object.keys(PAGE_STARTERS) as Array<keyof typeof PAGE_STARTERS>)('page starter %s survives sanitising', (k) => {
    const t = PAGE_STARTERS[k].build();
    expect(survives('page', t)).toBe(t.order.length);
  });

  it('builds fresh ids on every call', () => {
    const a = defaultTemplate('product');
    const b = defaultTemplate('product');
    expect(a.order.some((id) => b.order.includes(id))).toBe(false);
  });

  it('the Studio and Blank presets start with a product page and a catalog page', () => {
    for (const p of [studioPreset(ctx), blankPreset(ctx)]) {
      expect(p.templates.product.order.length).toBeGreaterThan(0);
      expect(p.templates.catalog.order.length).toBe(2);
    }
  });

  it('the Studio and Blank headers link All Products to the catalog', () => {
    for (const p of [studioPreset(ctx), blankPreset(ctx)]) {
      const header = Object.values(p.header_group.sections).find((s) => s.type === 'header')!;
      const links = Object.values(header.blocks).map((b) => b.settings);
      expect(links).toContainEqual({ label: 'All Products', link: '/catalog' });
    }
  });
});
