import { collectDataRequests, productRequestKey } from '@/lib/store/engine/section-data';
import type { Section, Template } from '@/lib/store/engine/types';

function section(type: string, settings: Record<string, unknown> = {}, disabled = false): Section {
  return { type, settings, blocks: {}, block_order: [], ...(disabled ? { disabled: true } : {}) };
}

function group(sections: Record<string, Section>): Template {
  return { order: Object.keys(sections), sections };
}

describe('collectDataRequests', () => {
  it('skips disabled sections and sections without a data function', () => {
    const map = collectDataRequests([
      group({
        a: section('product-rail', { source: 'new', limit: 4 }),
        b: section('product-rail', { source: 'new', limit: 4 }, true),
        c: section('rich-text'),
        d: section('category-grid'),
        e: section('no-such-type'),
      }),
    ]);
    expect([...map.keys()].sort()).toEqual(['a', 'd']);
    expect(map.get('d')).toEqual({ categories: true });
  });

  it('collects across several groups', () => {
    const map = collectDataRequests([
      group({ a: section('featured-products') }),
      group({ b: section('category-grid') }),
    ]);
    expect([...map.keys()].sort()).toEqual(['a', 'b']);
  });

  it('gives two rails with the same request the same key and different requests different keys', () => {
    const map = collectDataRequests([
      group({
        r1: section('product-rail', { source: 'new', limit: 8 }),
        r2: section('product-rail', { source: 'new', limit: 8 }),
        r3: section('product-rail', { source: 'bestsellers', limit: 8 }),
      }),
    ]);
    const key = (id: string) => productRequestKey(map.get(id)!.products!);
    expect(key('r1')).toBe(key('r2'));
    expect(key('r1')).not.toBe(key('r3'));
  });
});

describe('resolveSectionData for demo stores', () => {
  it('serves products and categories from the demo catalog without touching the database', async () => {
    const { resolveSectionData } = await import('@/lib/store/engine/section-data');
    const { themeDemoStore } = await import('@/lib/store/theme-demo');
    const store = themeDemoStore('theme-studio');
    expect(store?.is_demo).toBe(true);
    const out = await resolveSectionData(
      store!,
      new Map([
        ['f', { products: { source: 'featured' as const, limit: 3 } }],
        ['c', { categories: true }],
      ]),
    );
    expect(out.f.error).toBeUndefined();
    expect(out.f.products!.length).toBeGreaterThan(0);
    expect(out.f.products!.length).toBeLessThanOrEqual(3);
    expect(out.c.categories!.length).toBeGreaterThan(0);
    expect(out.c.categories![0].image_url).toBeNull();
  });
});
