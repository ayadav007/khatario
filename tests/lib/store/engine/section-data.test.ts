jest.mock('@/lib/db', () => ({ queryRows: jest.fn() }));
jest.mock('@/lib/store/seller-gst', () => ({
  storeCollectsGst: jest.fn().mockResolvedValue(true),
  withStoreGst: (item: unknown) => item,
}));

import { queryRows } from '@/lib/db';
import { collectDataRequests, collectProductIds, productRequestKey, resolveSectionData } from '@/lib/store/engine/section-data';
import type { SectionDataRequest } from '@/lib/store/engine/schema-types';
import type { StoreBusinessContext } from '@/lib/store/resolve-store';
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

describe('collectDataRequests with blocks', () => {
  it('hands each schema its enabled blocks in order', () => {
    const A = '11111111-1111-4111-8111-111111111111';
    const B = '22222222-2222-4222-8222-222222222222';
    const C = '33333333-3333-4333-8333-333333333333';
    const look: Section = {
      type: 'shop-the-look',
      settings: {},
      blocks: {
        'hotspot-1': { type: 'hotspot', settings: { product: A }, disabled: true },
        'hotspot-2': { type: 'hotspot', settings: { product: B } },
        'hotspot-3': { type: 'hotspot', settings: { product: C } },
      },
      block_order: ['hotspot-3', 'hotspot-2', 'hotspot-1'],
    };
    const map = collectDataRequests([group({ look })]);
    expect(map.get('look')).toEqual({ productIds: [C, B] });
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
    // Like the old storefront, a demo category shows its first product photo (by name).
    expect(out.c.categories![0].image_url).toMatch(/^https:\/\//);
  });
});

describe('M4 data requests', () => {
  it('category-shelves asks for shelves with its defaults; the header always asks for categories (Quick pills and hints), optional', () => {
    const map = collectDataRequests([
      group({
        shelves: section('category-shelves'),
        h: section('header'),
        chips: section('header', { show_category_chips: true }),
      }),
    ]);
    expect(map.get('shelves')).toEqual({ shelves: { maxCategories: 6, perShelf: 8 } });
    expect(map.get('h')).toEqual({ categories: true, categoriesOptional: true });
    expect(map.get('chips')).toEqual({ categories: true, categoriesOptional: true });
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

describe('products by id', () => {
  const queryMock = queryRows as jest.Mock;
  const a = '11111111-1111-4111-8111-111111111111';
  const b = '22222222-2222-4222-8222-222222222222';
  const c = '33333333-3333-4333-8333-333333333333';
  const store = { business_id: '99999999-9999-4999-8999-999999999999', store_subdomain: 'ganesh' } as StoreBusinessContext;
  const row = (id: string) => ({ id, name: `Item ${id.slice(0, 1)}`, selling_price: 100, mrp: null });

  beforeEach(() => queryMock.mockReset());

  it('collectProductIds dedupes across sections, drops non-uuids and keeps first-seen order', () => {
    const m = new Map<string, SectionDataRequest>([
      ['s1', { productIds: [a, 'junk'] }],
      ['s2', { productIds: [b, a] }],
      ['s3', { categories: true }],
    ]);
    expect(collectProductIds(m)).toEqual([a, b]);
  });

  it('collectProductIds takes at most 12 ids per section', () => {
    const many = Array.from({ length: 15 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
    expect(collectProductIds(new Map([['s', { productIds: many }]]))).toEqual(many.slice(0, 12));
  });

  it('gives each section only its own ids, in its own order, from one query', async () => {
    // The query returns rows in its own order; unknown ids are simply absent.
    queryMock.mockResolvedValue([row(a), row(b)]);
    const out = await resolveSectionData(
      store,
      new Map<string, SectionDataRequest>([
        ['s1', { productIds: [b, a] }],
        ['s2', { productIds: [a, c, 'not-a-uuid'] }],
        ['s3', { productIds: [c] }],
      ]),
    );
    expect(queryMock).toHaveBeenCalledTimes(1);
    expect(queryMock.mock.calls[0][1]).toContainEqual([b, a, c]);
    expect(Object.keys(out.s1.productsById!)).toEqual([b, a]);
    expect(Object.keys(out.s2.productsById!)).toEqual([a]);
    expect(out.s3.productsById).toEqual({});
    expect(out.s1.error).toBeUndefined();
  });

  it('a failed ids query gives only the sections that asked for ids no products and the failed flag, never an error', async () => {
    queryMock.mockRejectedValue(new Error('statement timeout'));
    const out = await resolveSectionData(
      store,
      new Map<string, SectionDataRequest>([
        ['s1', { productIds: [a] }],
        ['s2', { categories: true, categoriesOptional: true }],
        ['s3', { productIds: ['junk'] }],
      ]),
    );
    // Like optional categories: the section still renders (RenderTemplate drops sections with an error).
    expect(out.s1.error).toBeUndefined();
    expect(out.s1.productsById).toEqual({});
    expect(out.s1.productsFailed).toBe(true);
    expect(out.s2.error).toBeUndefined();
    expect(out.s2.productsFailed).toBeUndefined();
    // A section with no valid ids asked for nothing, so nothing failed for it.
    expect(out.s3.productsById).toEqual({});
    expect(out.s3.productsFailed).toBeUndefined();
    expect(out.s3.error).toBeUndefined();
  });

  it('runs no query when no section asks for ids', async () => {
    const out = await resolveSectionData(store, new Map<string, SectionDataRequest>([['s1', { productIds: ['junk'] }]]));
    expect(queryMock).not.toHaveBeenCalled();
    expect(out.s1.productsById).toEqual({});
  });
});

describe('out-of-stock place', () => {
  const queryMock = queryRows as jest.Mock;
  const a = '11111111-1111-4111-8111-111111111111';
  const store = { business_id: '99999999-9999-4999-8999-999999999999', store_subdomain: 'ganesh' } as StoreBusinessContext;
  const sqls = () => queryMock.mock.calls.map((c) => String(c[0]));

  beforeEach(() => {
    queryMock.mockReset();
    queryMock.mockResolvedValue([]);
  });

  it('adds nothing for stay or no option: the product SQL stays as it was', async () => {
    const req = new Map<string, SectionDataRequest>([['s', { products: { source: 'new', limit: 4 }, productIds: [a] }]]);
    await resolveSectionData(store, req);
    const plain = sqls();
    queryMock.mockClear();
    await resolveSectionData(store, req, { outOfStock: 'stay' });
    expect(sqls()).toEqual(plain);
    expect(plain.join('\n')).not.toContain('ovs');
  });

  it('end orders section products, hand-picked products keep their order', async () => {
    await resolveSectionData(
      store,
      new Map<string, SectionDataRequest>([['s', { products: { source: 'new', limit: 4 }, productIds: [a] }]]),
      { outOfStock: 'end' },
    );
    const [list, byIds] = sqls().sort((x, y) => (x.includes('array_position') ? 1 : 0) - (y.includes('array_position') ? 1 : 0));
    expect(list).toContain('THEN 1 ELSE 0 END ASC, i.created_at DESC');
    expect(byIds).toContain('array_position(');
    expect(byIds).not.toContain('THEN 1 ELSE 0 END');
  });

  it('hide drops out-of-stock products from section lists, hand-picked ones and category counts', async () => {
    await resolveSectionData(
      store,
      new Map<string, SectionDataRequest>([
        ['s', { products: { source: 'featured', limit: 4 }, productIds: [a] }],
        ['c', { categories: true }],
      ]),
      { outOfStock: 'hide' },
    );
    const itemQueries = sqls().filter((q) => q.includes('NOT (CASE WHEN COALESCE(i.has_variants'));
    // featured list, by-ids list and the categories count
    expect(itemQueries).toHaveLength(3);
  });
});
