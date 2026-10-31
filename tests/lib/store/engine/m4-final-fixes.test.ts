jest.mock('@/lib/db', () => ({ queryRows: jest.fn() }));

import { queryRows } from '@/lib/db';
import { collectDataRequests, productRequestKey, resolveSectionData } from '@/lib/store/engine/section-data';
import { catalogRedirect } from '@/lib/store/engine/links';
import { hasEnabledSection } from '@/lib/store/engine/page-loader';
import { migrateStoreTheme } from '@/lib/store/engine/migrate';
import { parseCatalogFilters, toApiParams } from '@/components/store/features/catalog/catalog-filters';
import { themeDemoStore } from '@/lib/store/theme-demo';
import type { StoreBusinessContext } from '@/lib/store/resolve-store';
import type { Section, Template } from '@/lib/store/engine/types';
import { menuCategories } from '@/components/store/engine/sections/shared';
import { ctx, namedGrocery, studioDerived } from './fixtures/store-themes';

const queryMock = queryRows as jest.Mock;
const store = { business_id: '11111111-2222-3333-4444-555555555555', store_subdomain: 'ganesh' } as StoreBusinessContext;

function section(type: string, settings: Record<string, unknown> = {}): Section {
  return { type, settings, blocks: {}, block_order: [] };
}
function group(sections: Record<string, Section>): Template {
  return { order: Object.keys(sections), sections };
}

beforeEach(() => jest.clearAllMocks());

describe('I1: a failed category lookup keeps the header', () => {
  it('the header with chips asks for optional categories', () => {
    const map = collectDataRequests([group({ h: section('header', { show_category_chips: true }) })]);
    expect(map.get('h')).toEqual({ categories: true, categoriesOptional: true });
  });

  it('gives the header no categories (not an error) while the category grid still fails', async () => {
    queryMock.mockRejectedValue(new Error('canceling statement due to statement timeout'));
    const requests = collectDataRequests([
      group({ h: section('header', { show_category_chips: true }) }),
      group({ g: section('category-grid') }),
    ]);
    const out = await resolveSectionData(store, requests);
    expect(out.h).toEqual({ categories: [], categoriesFailed: true });
    expect(out.h.error).toBeUndefined();
    expect(out.g.error).toMatch(/timeout/);
  });

  it('a failed lookup gives the menu null categories, so its hand-picked category links stay', async () => {
    queryMock.mockRejectedValue(new Error('canceling statement due to statement timeout'));
    const out = await resolveSectionData(store, collectDataRequests([group({ h: section('header') })]));
    expect(out.h.categoriesFailed).toBe(true);
    expect(menuCategories(out.h)).toBeNull();
  });

  it('still gives the header its categories when the lookup works', async () => {
    queryMock.mockResolvedValue([{ id: 'c1', name: 'Fruits', item_count: 3 }]);
    const out = await resolveSectionData(
      store,
      collectDataRequests([group({ h: section('header', { show_category_chips: true }) })]),
    );
    expect(out.h.categories).toEqual([{ id: 'c1', name: 'Fruits', item_count: 3, image_url: null }]);
    expect(out.h.categoriesFailed).toBeUndefined();
    expect(menuCategories(out.h)).toEqual([{ id: 'c1', name: 'Fruits', image_url: null }]);
  });
});

describe('I2: Offers links show discounted products', () => {
  it('narrows only all-products requests by minDiscountPct, in the query and in the shared-job key', async () => {
    queryMock.mockResolvedValue([]);
    const all = { source: 'all' as const, limit: 24 };
    const featured = { source: 'featured' as const, limit: 8 };
    expect(productRequestKey(all, { minDiscountPct: 10 })).not.toBe(productRequestKey(all));
    expect(productRequestKey(featured, { minDiscountPct: 10 })).toBe(productRequestKey(featured));

    await resolveSectionData(store, new Map([['a', { products: all }], ['f', { products: featured }]]), {
      minDiscountPct: 10,
    });
    const sqls = queryMock.mock.calls.map(([sql, params]) => ({ sql: String(sql), params: params as unknown[] }));
    const discounted = sqls.filter((c) => c.sql.includes('(i.mrp - i.selling_price) / i.mrp * 100 >='));
    expect(discounted).toHaveLength(1);
    expect(discounted[0].params).toContain(10);
  });

  it('narrows demo stores too: every all-products item is at least 10% off', async () => {
    const demo = themeDemoStore('theme-grocery')!;
    const plain = await resolveSectionData(demo, new Map([['a', { products: { source: 'all', limit: 100 } }]]));
    const out = await resolveSectionData(demo, new Map([['a', { products: { source: 'all', limit: 100 } }]]), {
      minDiscountPct: 10,
    });
    expect(out.a.products!.length).toBeGreaterThan(0);
    expect(out.a.products!.length).toBeLessThan(plain.a.products!.length);
    for (const p of out.a.products!) {
      expect(p.mrp).not.toBeNull();
      expect(((p.mrp! - p.selling_price) / p.mrp!) * 100).toBeGreaterThanOrEqual(10);
    }
  });

  it.each([
    ['Grocery', namedGrocery],
    ['Studio', studioDerived],
  ])('a migrated %s store (empty catalog) sends /catalog?disc=10 to a home with an all-products grid', (_n, raw) => {
    const r = migrateStoreTheme(raw, ctx);
    expect(hasEnabledSection(r.data.templates.catalog)).toBe(false);
    expect(catalogRedirect(false, '/catalog', '?disc=10')).toBe('/?disc=10');
    // The engine home with a catalog template that is empty never redirects `disc` away...
    expect(catalogRedirect(true, '/', '?disc=10')).toBeNull();
    // ...and its all-products grid is the one that `disc` narrows.
    const home = r.data.templates.home;
    expect(home.order.some((id) => home.sections[id].settings.source === 'all')).toBe(true);
  });

  it('a filled catalog template reads disc=10 from the URL into the products API call', () => {
    const value = parseCatalogFilters(new URLSearchParams('disc=10'));
    expect(value.disc).toBe(10);
    expect(toApiParams(value).get('disc')).toBe('10');
  });
});
