import { defaultTemplate, PAGE_STARTERS } from '@/lib/store/engine/presets/templates';
import { studioPreset } from '@/lib/store/engine/presets/studio';
import { blankPreset } from '@/lib/store/engine/presets/blank';
import { sanitizeThemeData } from '@/lib/store/engine/sanitize';
import type { Template } from '@/lib/store/engine/types';

const ctx = { businessName: 'Shop', tagline: 'Hello', accent: '#2563eb', logoUrl: null, heroUrl: null } as never;

function survives(key: 'product' | 'page', t: Template) {
  const data = sanitizeThemeData({ templates: key === 'product' ? { product: t } : { 'page.x': t } });
  const out = key === 'product' ? data.templates.product : data.templates['page.x'];
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

  it.each(Object.keys(PAGE_STARTERS) as Array<keyof typeof PAGE_STARTERS>)('page starter %s survives sanitising', (k) => {
    const t = PAGE_STARTERS[k].build();
    expect(survives('page', t)).toBe(t.order.length);
  });

  it('builds fresh ids on every call', () => {
    const a = defaultTemplate('product');
    const b = defaultTemplate('product');
    expect(a.order.some((id) => b.order.includes(id))).toBe(false);
  });

  it('the Studio and Blank presets start with a product page', () => {
    expect(studioPreset(ctx).templates.product.order.length).toBeGreaterThan(0);
    expect(blankPreset(ctx).templates.product.order.length).toBeGreaterThan(0);
  });
});
