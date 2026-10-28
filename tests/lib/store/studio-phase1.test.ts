import { sanitizeStudioSections } from '@/lib/store/studio-sections';
import { isCatalogSection, newStudioSection, studioProductParams } from '@/lib/store/studio-layout';
import { isNewArrival, lowStockCount } from '@/lib/store/map-store-product';
import { buildStoreItemsQuery, parseStoreItemsSort } from '@/lib/store/store-items-query';

describe('Studio sections: repeatable types', () => {
  it('keeps several product, banner, USP and marquee sections but only one hero', () => {
    const out = sanitizeStudioSections([
      { id: 'hero', type: 'hero', settings: {} },
      { id: 'hero2', type: 'hero', settings: {} },
      { id: 'p1', type: 'products', settings: {} },
      { id: 'p2', type: 'products', settings: { source: 'new' } },
      { id: 'b1', type: 'banner', settings: {} },
      { id: 'b2', type: 'banner', settings: {} },
      { id: 'u1', type: 'usp', settings: {} },
      { id: 'm1', type: 'marquee', settings: {} },
      { id: 'm2', type: 'marquee', settings: {} },
    ]);
    expect(out.map((s) => s.id)).toEqual(['hero', 'p1', 'p2', 'b1', 'b2', 'u1', 'm1', 'm2']);
  });

  it('treats product sections without a source as the catalog', () => {
    const [legacy, sourced] = sanitizeStudioSections([
      { id: 'p1', type: 'products', settings: { title: 'Old' } },
      { id: 'p2', type: 'products', settings: { source: 'bestsellers' } },
    ]);
    expect(isCatalogSection(legacy)).toBe(true);
    expect(isCatalogSection(sourced)).toBe(false);
  });

  it('starts new sections with usable content', () => {
    expect(newStudioSection('products', 'x').settings.source).toBe('new');
    expect(newStudioSection('marquee', 'm').settings.text).toContain(',');
    expect(newStudioSection('richtext', 'r').type).toBe('richtext');
  });
});

describe('Studio settings sanitising', () => {
  it('cleans hero slides: caps at 5, drops script links and clips text', () => {
    const [hero] = sanitizeStudioSections([
      {
        id: 'hero',
        type: 'hero',
        settings: {
          autoplay: 99,
          slides: [
            { heading: 'A'.repeat(500), image: 'javascript:alert(1)', link: 'javascript:alert(1)', buttonText: 'Go' },
            { heading: 'B', image: 'https://cdn.example.com/b.jpg', link: '/?offers=1' },
            { heading: 'C', link: 'data:image/png;base64,AAAA' },
            ...Array.from({ length: 5 }, (_, i) => ({ heading: `X${i}` })),
          ],
        },
      },
    ]);
    const slides = hero.settings.slides!;
    expect(slides).toHaveLength(5);
    expect(slides[0].heading).toHaveLength(120);
    expect(slides[0].image).toBe('');
    expect(slides[0].link).toBe('');
    expect(slides[1]).toMatchObject({ image: 'https://cdn.example.com/b.jpg', link: '/?offers=1', description: '' });
    expect(slides[2].link).toBe('');
    expect(hero.settings.autoplay).toBe(15);
  });

  it('cleans USP items and product options', () => {
    const [usp, products] = sanitizeStudioSections([
      { id: 'u', type: 'usp', settings: { usps: [{ icon: 'rocket', title: 'Fast', text: 'x'.repeat(300) }, null] } },
      {
        id: 'p',
        type: 'products',
        settings: { source: 'everything', limit: 500, display: 'carousel', cardStyle: 'glow', imageRatio: 'portrait', showRating: false },
      },
    ]);
    expect(usp.settings.usps).toEqual([{ icon: 'badge', title: 'Fast', text: 'x'.repeat(120) }]);
    expect(products.settings.source).toBeUndefined();
    expect(products.settings.limit).toBe(24);
    expect(products.settings.display).toBe('carousel');
    expect(products.settings.cardStyle).toBeUndefined();
    expect(products.settings.imageRatio).toBe('portrait');
    expect(products.settings.showRating).toBe(false);
  });
});

describe('studioProductParams', () => {
  const q = (s: Parameters<typeof studioProductParams>[0]) => Object.fromEntries(studioProductParams(s));

  it('maps each source to the items API', () => {
    expect(q({ source: 'featured' })).toEqual({ limit: '8', featured: '1' });
    expect(q({ source: 'new', limit: 12 })).toEqual({ limit: '12', sort: 'new' });
    expect(q({ source: 'bestsellers' })).toEqual({ limit: '8', sort: 'bestsellers' });
    expect(q({ source: 'discounted' })).toEqual({ limit: '8', discounted: '1' });
    expect(q({ source: 'category', categoryId: 'c1' })).toEqual({ limit: '8', category_id: 'c1' });
    expect(q({ source: 'price_max', priceMax: 199 })).toEqual({ limit: '8', max_price: '199' });
  });
});

describe('product card badges', () => {
  const now = Date.parse('2026-10-28T00:00:00Z');

  it('marks items added in the last 30 days as new', () => {
    expect(isNewArrival('2026-10-20T10:00:00Z', now)).toBe(true);
    expect(isNewArrival('2026-09-01T10:00:00Z', now)).toBe(false);
    expect(isNewArrival(null, now)).toBe(false);
    expect(isNewArrival('not a date', now)).toBe(false);
  });

  it('shows "Only N left" for 1-5 units of a plain item', () => {
    expect(lowStockCount({ current_stock: 3 })).toBe(3);
    expect(lowStockCount({ current_stock: 5 })).toBe(5);
    expect(lowStockCount({ current_stock: 6 })).toBeUndefined();
    expect(lowStockCount({ current_stock: 0 })).toBeUndefined();
    expect(lowStockCount({ current_stock: 2, has_variants: true })).toBeUndefined();
  });
});

describe('buildStoreItemsQuery sort', () => {
  const businessId = '11111111-1111-1111-1111-111111111111';

  it('defaults to A-Z without the sales join', () => {
    const q = buildStoreItemsQuery({ businessId, limit: 8, offset: 0 });
    expect(q.listSql).toContain('ORDER BY i.name ASC');
    expect(q.listSql).not.toContain('store_order_items');
    expect(q.listSql).toContain('i.created_at');
  });

  it('orders new arrivals by created_at', () => {
    const q = buildStoreItemsQuery({ businessId, sort: 'new', limit: 8, offset: 0 });
    expect(q.listSql).toContain('ORDER BY i.created_at DESC NULLS LAST');
    expect(q.listParams).toEqual([businessId, 8, 0]);
  });

  it('ranks best sellers by store sales for this business, skipping cancelled orders', () => {
    const q = buildStoreItemsQuery({ businessId, sort: 'bestsellers', discountedOnly: true, limit: 8, offset: 0 });
    expect(q.listSql).toContain('store_order_items');
    expect(q.listSql).toContain('so.business_id = $1');
    expect(q.listSql).toContain("so.status <> 'cancelled'");
    expect(q.listSql).toContain('ORDER BY COALESCE(sold.sold, 0) DESC');
    expect(q.countSql).not.toContain('store_order_items');
  });

  it('parses unknown sort values as A-Z', () => {
    expect(parseStoreItemsSort('new')).toBe('new');
    expect(parseStoreItemsSort('bestsellers')).toBe('bestsellers');
    expect(parseStoreItemsSort('price; drop table')).toBe('name');
    expect(parseStoreItemsSort(null)).toBe('name');
  });
});
