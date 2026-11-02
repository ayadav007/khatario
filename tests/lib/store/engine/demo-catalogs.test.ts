import fs from 'fs';
import path from 'path';
import { DEMO_CATALOGS, demoCatalog } from '@/lib/store/engine/demo-catalogs';
import type { DemoCatalogId } from '@/lib/store/engine/theme-catalog';

const IDS: DemoCatalogId[] = ['jewellery', 'fashion', 'grocery', 'general', 'streetwear'];
const PREFIX: Record<DemoCatalogId, string> = { jewellery: 'jw-', fashion: 'fa-', grocery: 'gr-', general: 'ge-', streetwear: 'sw-' };
const credits = fs.readFileSync('public/theme-demos/CREDITS.md', 'utf8');
const exists = (url: string) => fs.existsSync(path.join('public', url));

describe('demo catalogues', () => {
  it('has the five catalogues', () => {
    expect(Object.keys(DEMO_CATALOGS).sort()).toEqual([...IDS].sort());
    for (const id of IDS) expect(demoCatalog(id)).toBe(DEMO_CATALOGS[id]);
  });

  it.each(IDS)('%s: 4–6 categories and 12–20 products, each in one of its categories, with its prefix', (id) => {
    const c = DEMO_CATALOGS[id];
    expect(c.categories.length).toBeGreaterThanOrEqual(4);
    expect(c.categories.length).toBeLessThanOrEqual(6);
    expect(c.products.length).toBeGreaterThanOrEqual(12);
    expect(c.products.length).toBeLessThanOrEqual(20);
    const cats = new Set(c.categories.map((x) => x.id));
    for (const cat of c.categories) expect(cat.id.startsWith(PREFIX[id])).toBe(true);
    for (const p of c.products) {
      expect(p.id.startsWith(PREFIX[id])).toBe(true);
      expect(cats.has(p.category_id as string)).toBe(true);
      expect(p.category_name).toBe(c.categories.find((x) => x.id === p.category_id)?.name);
      // Only the streetwear catalogue has sized products; stock then is the sum of the sizes.
      if (p.has_variants) expect(p.current_stock).toBe(p.variants.reduce((n, v) => n + v.current_stock, 0));
      else expect(p.current_stock).toBe(20);
      expect(p.selling_price).toBeGreaterThan(0);
      if (p.mrp != null) expect(p.mrp).toBeGreaterThan(p.selling_price);
    }
    // Every category has something in it.
    for (const cat of c.categories) expect(c.products.some((p) => p.category_id === cat.id)).toBe(true);
  });

  it('streetwear products have sizes, some sold out', () => {
    const { products, categories } = DEMO_CATALOGS.streetwear;
    expect(categories.map((c) => c.name)).toEqual(['Tees', 'Co-ords', 'Denim', 'Accessories']);
    expect(products.length).toBeGreaterThanOrEqual(12);
    expect(products.length).toBeLessThanOrEqual(16);
    const sized = products.filter((p) => p.has_variants);
    expect(sized.length).toBeGreaterThanOrEqual(8);
    const sizesOf = (p: (typeof products)[number]) => p.variants.map((v) => (v.attributes as { size: string }).size);
    for (const p of sized) {
      const sizes = sizesOf(p);
      expect(sizes.length).toBeGreaterThan(1);
      expect(new Set(sizes).size).toBe(sizes.length);
      const allowed = p.category_name === 'Denim' ? ['28', '30', '32', '34', '36'] : ['S', 'M', 'L', 'XL', 'XXL'];
      for (const s of sizes) expect(allowed).toContain(s);
      for (const v of p.variants) {
        expect(v.id).toBeTruthy();
        expect(v.variant_name).toBe((v.attributes as { size: string }).size);
        expect(v.selling_price).toBe(p.selling_price);
      }
    }
    const soldOut = sized.flatMap((p) => p.variants.filter((v) => v.current_stock === 0));
    expect(soldOut.length).toBeGreaterThanOrEqual(2);
    expect(products.filter((p) => ['Selling fast', 'Any 3 @ ₹999', 'New'].includes(p.store_badge ?? '')).length).toBeGreaterThanOrEqual(3);
    expect(products.filter((p) => p.store_fit_note).length).toBeGreaterThanOrEqual(3);
    for (const p of products) expect((p.store_fit_note ?? '').length).toBeLessThanOrEqual(80);
    // A product is never wholly sold out, so the demo shop always has something to buy.
    for (const p of products) expect(p.current_stock).toBeGreaterThan(0);
  });

  it("streetwear's newest-first row (the demo's \"new\" sort shows the list from the end) leads with sized tees and co-ords", () => {
    const { products } = DEMO_CATALOGS.streetwear;
    const firstEight = [...products].reverse().slice(0, 8);
    expect(firstEight.every((p) => p.has_variants)).toBe(true);
    expect(firstEight.slice(0, 4).map((p) => p.category_name)).toEqual(['Tees', 'Tees', 'Tees', 'Tees']);
    // The featured flag still marks the same eight products as before.
    expect(products.filter((p) => p.featured_in_store).map((p) => p.id).sort()).toEqual(
      ['sw-1', 'sw-2', 'sw-3', 'sw-4', 'sw-5', 'sw-6', 'sw-7', 'sw-8'],
    );
  });

  it('every row of the credits table has the same number of columns (no stray | in a name)', () => {
    const rows = credits.split('\n').filter((l) => l.startsWith('|'));
    const cols = (l: string) => l.split('|').length;
    expect(rows.length).toBeGreaterThan(10);
    for (const r of rows) expect(cols(r)).toBe(cols(rows[0]));
  });

  it('ids are unique across all catalogues', () => {
    const all = IDS.flatMap((id) => DEMO_CATALOGS[id].products.map((p) => p.id));
    expect(new Set(all).size).toBe(all.length);
  });

  it.each(IDS)('%s: every photo is our own file, on disk and credited; at least two heroes', (id) => {
    const c = DEMO_CATALOGS[id];
    expect(c.heroes.length).toBeGreaterThanOrEqual(2);
    for (const url of [...c.products.map((p) => p.image_url as string), ...c.heroes]) {
      expect(url).toMatch(/^\/theme-demos\/(jewellery|fashion|grocery|general|streetwear|heroes)\/[a-z0-9-]+\.webp$/);
      expect(exists(url)).toBe(true);
      expect(credits).toContain(`| ${url.replace('/theme-demos/', '')} |`);
    }
    for (const p of c.products) expect(p.image_url?.startsWith(`/theme-demos/${id}/`)).toBe(true);
  });
});
