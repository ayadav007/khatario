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

describe('M4 data requests', () => {
  it('category-shelves asks for shelves with its defaults; the header asks for categories only with chips', () => {
    const map = collectDataRequests([
      group({
        shelves: section('category-shelves'),
        h: section('header'),
        chips: section('header', { show_category_chips: true }),
      }),
    ]);
    expect(map.get('shelves')).toEqual({ shelves: { maxCategories: 6, perShelf: 8 } });
    expect(map.get('h')).toEqual({});
    expect(map.get('chips')).toEqual({ categories: true });
  });

  it('demo stores get one shelf per demo category, each of that category only', async () => {
    const { resolveSectionData } = await import('@/lib/store/engine/section-data');
    const { themeDemoStore } = await import('@/lib/store/theme-demo');
    const store = themeDemoStore('theme-grocery');
    const out = await resolveSectionData(store!, new Map([['s', { shelves: { maxCategories: 2, perShelf: 4 } }]]));
    expect(out.s.error).toBeUndefined();
    expect(out.s.shelves!.length).toBeGreaterThan(0);
    expect(out.s.shelves!.length).toBeLessThanOrEqual(2);
    for (const shelf of out.s.shelves!) {
      expect(shelf.products.length).toBeGreaterThan(0);
      expect(shelf.products.length).toBeLessThanOrEqual(4);
      for (const p of shelf.products) expect(p.category_id).toBe(shelf.category.id);
    }
  });
});
