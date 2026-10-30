import { buildRelatedQuery } from '@/lib/store/related-products';
import { assertQueryBinds, buildStoreItemsQuery } from '@/lib/store/store-items-query';
import { pushRecentlyViewed, readRecentlyViewed } from '@/lib/store/recently-viewed';
import { productJsonLd } from '@/lib/store/product-jsonld';
import { validateProductExtras, videoEmbed } from '@/lib/store/product-extras';

function fakeStorage(seed: Record<string, string> = {}) {
  const data = { ...seed };
  return {
    getItem: (k: string) => (k in data ? data[k] : null),
    setItem: (k: string, v: string) => {
      data[k] = v;
    },
    data,
  };
}

describe('buildRelatedQuery', () => {
  const input = { businessId: 'b1', itemId: 'i1', categoryId: 'c1', brand: 'Acme' };

  it('excludes the item, keeps visibility rules and ranks by category, brand, sales', () => {
    const { sql, params } = buildRelatedQuery(input);
    expect(sql).toMatch(/i\.id <> \$\d+/);
    expect(sql).toContain('i.show_in_store = true');
    expect(sql).toContain('i.deleted_at IS NULL');
    expect(sql).toMatch(/ORDER BY\s+CASE/);
    expect(sql).toMatch(/THEN 0/);
    expect(sql).toMatch(/THEN 1/);
    expect(sql).toMatch(/ELSE 2/);
    expect(sql).toContain("so.status <> 'cancelled'");
    expect(sql).toContain('ORDER BY iv.created_at, iv.id');
    expect(params).toContain('i1');
    expect(params[params.length - 1]).toBe(8);
    expect(() => assertQueryBinds(sql, params)).not.toThrow();
  });

  it('binds with null category and brand', () => {
    const { sql, params } = buildRelatedQuery({ ...input, categoryId: null, brand: null, limit: 4 });
    expect(() => assertQueryBinds(sql, params)).not.toThrow();
    expect(params[params.length - 1]).toBe(4);
  });
});

describe('recently viewed', () => {
  it('dedupes, puts newest first and caps at 12', () => {
    const s = fakeStorage();
    for (let n = 1; n <= 15; n++) pushRecentlyViewed('shop', `id${n}`, s);
    pushRecentlyViewed('shop', 'id10', s);
    const ids = readRecentlyViewed('shop', undefined, s);
    expect(ids).toHaveLength(12);
    expect(ids[0]).toBe('id10');
    expect(new Set(ids).size).toBe(12);
    expect(s.data['kh_rv_shop']).toBeDefined();
  });

  it('excludes an id when reading', () => {
    const s = fakeStorage();
    pushRecentlyViewed('shop', 'a', s);
    pushRecentlyViewed('shop', 'b', s);
    expect(readRecentlyViewed('shop', 'b', s)).toEqual(['a']);
  });

  it('survives corrupt or throwing storage', () => {
    expect(readRecentlyViewed('shop', undefined, fakeStorage({ kh_rv_shop: '{oops' }))).toEqual([]);
    const bad = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(() => pushRecentlyViewed('shop', 'a', bad)).not.toThrow();
    expect(readRecentlyViewed('shop', undefined, bad)).toEqual([]);
  });
});

describe('productJsonLd', () => {
  const p = {
    name: 'Kurta',
    description: 'Cotton kurta',
    images: ['https://x.test/a.jpg'],
    sku: 'K-1',
    brand: 'Acme',
    price: 499,
    inStock: true,
    url: 'https://shop.test/p/1',
  };

  it('builds a Product with INR offers and no rating when count is 0', () => {
    const j: any = productJsonLd(p, { avg: 0, count: 0 });
    expect(j['@type']).toBe('Product');
    expect(j.offers.priceCurrency).toBe('INR');
    expect(j.offers.availability).toBe('https://schema.org/InStock');
    expect(j.sku).toBe('K-1');
    expect(j.brand).toEqual({ '@type': 'Brand', name: 'Acme' });
    expect(j.aggregateRating).toBeUndefined();
  });

  it('marks out of stock, rounds rating and omits empty fields', () => {
    const j: any = productJsonLd(
      { ...p, inStock: false, sku: null, brand: null, description: '', images: [] },
      { avg: 4.26, count: 3 },
    );
    expect(j.offers.availability).toBe('https://schema.org/OutOfStock');
    expect(j.aggregateRating).toEqual({ '@type': 'AggregateRating', ratingValue: 4.3, reviewCount: 3 });
    expect(j).not.toHaveProperty('sku');
    expect(j).not.toHaveProperty('brand');
    expect(j).not.toHaveProperty('description');
    expect(j).not.toHaveProperty('image');
  });
});

describe('validateProductExtras', () => {
  it('rejects http YouTube and unknown hosts, accepts youtu.be and mp4', () => {
    expect(validateProductExtras({ video_url: 'http://youtube.com/watch?v=abc123' }).ok).toBe(false);
    expect(validateProductExtras({ video_url: 'https://vimeo.com/123456' }).ok).toBe(false);
    expect(validateProductExtras({ video_url: 'https://youtu.be/abc123' })).toEqual({
      ok: true,
      value: { video_url: 'https://youtu.be/abc123' },
    });
    expect(validateProductExtras({ video_url: 'https://cdn.test/a.mp4?x=1' }).ok).toBe(true);
    expect(validateProductExtras({ video_url: '  ' })).toEqual({ ok: true, value: { video_url: null } });
  });

  it('limits tabs and drops empty ones', () => {
    const tab = (n: number) => ({ title: `T${n}`, body: 'b' });
    const five = validateProductExtras({ store_tabs: [1, 2, 3, 4, 5].map(tab) });
    expect(five).toEqual({ ok: false, error: 'You can add up to 4 tabs.' });
    const r = validateProductExtras({
      store_tabs: [tab(1), { title: ' ', body: ' ' }, { title: ' Care ', body: ' wash cold ' }],
    });
    expect(r).toEqual({
      ok: true,
      value: { store_tabs: [tab(1), { title: 'Care', body: 'wash cold' }] },
    });
    expect(validateProductExtras({ store_tabs: [{ title: 'x'.repeat(41), body: 'b' }] }).ok).toBe(false);
    expect(validateProductExtras({ store_tabs: [{ title: 'x', body: 'b'.repeat(4001) }] }).ok).toBe(false);
  });

  it('validates the size chart', () => {
    const cols = (n: number) => Array.from({ length: n }, (_, i) => `C${i}`);
    expect(validateProductExtras({ size_chart: { columns: cols(9), rows: [] } }).ok).toBe(false);
    expect(
      validateProductExtras({ size_chart: { columns: cols(2), rows: Array(21).fill(['a', 'b']) } }).ok,
    ).toBe(false);
    expect(validateProductExtras({ size_chart: { columns: cols(2), rows: [['a']] } }).ok).toBe(false);
    expect(
      validateProductExtras({ size_chart: { columns: cols(2), rows: [['a', 'x'.repeat(41)]] } }).ok,
    ).toBe(false);
    expect(validateProductExtras({ size_chart: { columns: ['S', 'M'], rows: [['1', '2']] } })).toEqual({
      ok: true,
      value: { size_chart: { columns: ['S', 'M'], rows: [['1', '2']] } },
    });
    expect(validateProductExtras({ size_chart: null })).toEqual({ ok: true, value: { size_chart: null } });
  });

  it('ignores absent keys', () => {
    expect(validateProductExtras({})).toEqual({ ok: true, value: {} });
  });
});

describe('videoEmbed', () => {
  it('maps YouTube forms to nocookie embeds', () => {
    const base = 'https://www.youtube-nocookie.com/embed/';
    expect(videoEmbed('https://www.youtube.com/watch?v=abc123')).toEqual({ kind: 'youtube', src: `${base}abc123` });
    expect(videoEmbed('https://youtu.be/abc123?t=4')).toEqual({ kind: 'youtube', src: `${base}abc123` });
    expect(videoEmbed('https://youtube.com/shorts/abc123')?.src).toBe(`${base}abc123`);
    expect(videoEmbed('https://www.youtube.com/embed/abc123')?.src).toBe(`${base}abc123`);
  });

  it('accepts https mp4/webm files and rejects the rest', () => {
    expect(videoEmbed('https://cdn.test/a.webm')).toEqual({ kind: 'file', src: 'https://cdn.test/a.webm' });
    expect(videoEmbed('http://cdn.test/a.mp4')).toBeNull();
    expect(videoEmbed('https://cdn.test/a.mov')).toBeNull();
    expect(videoEmbed('https://www.youtube.com/watch?v=a')).toBeNull();
    expect(videoEmbed('not a url')).toBeNull();
  });
});

describe('related vs list select', () => {
  const aliases = (sql: string) =>
    Array.from(sql.matchAll(/\bAS\s+([a-z_]+)/g)).map((m) => m[1]);

  it('selects the same aliases as the items list', () => {
    const list = buildStoreItemsQuery({ businessId: 'b1', limit: 5, offset: 0 }).listSql;
    const related = buildRelatedQuery({ businessId: 'b1', itemId: 'i1', categoryId: null, brand: null }).sql;
    const head = (sql: string) => sql.slice(0, sql.indexOf('FROM items i'));
    expect(aliases(head(related))).toEqual(aliases(head(list)));
    expect(head(list)).toContain('ORDER BY iv.created_at, iv.id');
  });

  it('reads branch stock when a branch is given', () => {
    const { sql, params } = buildRelatedQuery({
      businessId: 'b1',
      itemId: 'i1',
      categoryId: null,
      brand: null,
      branchId: 'br1',
    });
    expect(params).toContain('br1');
    expect(sql).toContain('branch_item_stock');
    expect(sql).toContain('branch_item_variant_stock');
    expect(() => assertQueryBinds(sql, params)).not.toThrow();
    const plain = buildRelatedQuery({ businessId: 'b1', itemId: 'i1', categoryId: null, brand: null }).sql;
    expect(plain).not.toContain('branch_item_stock');
  });
});
