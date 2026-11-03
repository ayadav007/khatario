import fs from 'fs';
import path from 'path';
import { DEMO_CATALOGS, demoCatalog } from '@/lib/store/engine/demo-catalogs';
import { DEMO_BUY_AGAIN } from '@/lib/store/engine/demo-catalogs';
import type { DemoCatalogId } from '@/lib/store/engine/theme-catalog';
import { unitPrice } from '@/lib/store/unit-price';

const IDS: DemoCatalogId[] = ['jewellery', 'fashion', 'grocery', 'general', 'streetwear', 'kirana'];
const PREFIX: Record<DemoCatalogId, string> = { jewellery: 'jw-', fashion: 'fa-', grocery: 'gr-', general: 'ge-', streetwear: 'sw-', kirana: 'ki-' };
const credits = fs.readFileSync('public/theme-demos/CREDITS.md', 'utf8');
const exists = (url: string) => fs.existsSync(path.join('public', url));

describe('demo catalogues', () => {
  it('has the six catalogues', () => {
    expect(Object.keys(DEMO_CATALOGS).sort()).toEqual([...IDS].sort());
    for (const id of IDS) expect(demoCatalog(id)).toBe(DEMO_CATALOGS[id]);
  });

  it.each(IDS.filter((id) => id !== 'kirana'))('%s: 4–6 categories and 12–20 products, each in one of its categories, with its prefix', (id) => {
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
      // Only the streetwear and kirana catalogues have variants; stock then is the sum of the variants.
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

  it('kirana products: unbranded, pack sizes cheaper per kg or L in bigger packs, some packs sold out', () => {
    const { products, categories } = DEMO_CATALOGS.kirana;
    expect(categories.map((c) => c.name)).toEqual(['Vegetables', 'Fruits', 'Dairy & eggs', 'Atta rice & dal', 'Masala', 'Snacks & drinks']);
    expect(products.length).toBeGreaterThanOrEqual(18);
    expect(products.length).toBeLessThanOrEqual(22);
    const cats = new Set(categories.map((c) => c.id));
    for (const c of categories) expect(products.some((p) => p.category_id === c.id)).toBe(true);
    for (const p of products) {
      expect(cats.has(p.category_id as string)).toBe(true);
      expect(p.category_name).toBe(categories.find((x) => x.id === p.category_id)?.name);
      expect(p.selling_price).toBeGreaterThan(0);
      if (p.mrp != null) expect(p.mrp).toBeGreaterThan(p.selling_price);
      if (p.has_variants) expect(p.current_stock).toBe(p.variants.reduce((n, v) => n + v.current_stock, 0));
      else expect(p.current_stock).toBe(20);
      // A product is never wholly sold out, so the demo shop always has something to buy.
      expect(p.current_stock).toBeGreaterThan(0);
    }
    for (const brand of ['India Gate', 'Aashirvaad', 'Tata', 'Fortune', 'Amul', 'Britannia']) {
      for (const p of products) expect(p.name.toLowerCase()).not.toContain(brand.toLowerCase());
    }

    const packed = products.filter((p) => p.has_variants);
    expect(packed.length).toBeGreaterThanOrEqual(12);
    const labelOf = (v: (typeof packed)[number]['variants'][number]) => {
      const keys = Object.keys(v.attributes as Record<string, string>);
      expect(keys).toHaveLength(1);
      expect(['size', 'weight']).toContain(keys[0]);
      expect(v.variant_name).toBe((v.attributes as Record<string, string>)[keys[0]]);
      return v.variant_name;
    };
    let measured = 0;
    for (const p of packed) {
      expect(p.variants.length).toBeGreaterThan(1);
      const labels = p.variants.map(labelOf);
      expect(new Set(labels).size).toBe(labels.length);
      expect(p.selling_price).toBe(p.variants[0].selling_price);
      const rates = p.variants.map((v) => {
        const rate = unitPrice(labelOf(v), v.selling_price);
        return rate == null ? null : Number(rate.replace(/[^0-9.]/g, ''));
      });
      if (rates.every((r) => r != null)) {
        measured++;
        for (let i = 1; i < rates.length; i++) expect(rates[i]!).toBeLessThan(rates[i - 1]!);
      } else {
        // Counted packs (eggs) carry no per-unit price; each pack still costs more than the one before.
        for (let i = 1; i < p.variants.length; i++) expect(p.variants[i].selling_price).toBeGreaterThan(p.variants[i - 1].selling_price);
      }
    }
    expect(measured).toBeGreaterThanOrEqual(10);
    const soldOut = packed.flatMap((p) => p.variants.filter((v) => v.current_stock === 0));
    expect(soldOut.length).toBeGreaterThanOrEqual(2);
    expect(products.filter((p) => p.store_badge).length).toBeGreaterThanOrEqual(3);
    // At least six products carry an MRP, so "Today's deals" has something to show.
    expect(products.filter((p) => p.mrp != null).length).toBeGreaterThanOrEqual(6);
  });

  it('kirana buy-again ids are 4–8 products that exist in the catalogue, each once', () => {
    const ids = DEMO_BUY_AGAIN.kirana ?? [];
    expect(ids.length).toBeGreaterThanOrEqual(4);
    expect(ids.length).toBeLessThanOrEqual(8);
    expect(new Set(ids).size).toBe(ids.length);
    const have = new Set(DEMO_CATALOGS.kirana.products.map((p) => p.id));
    for (const id of ids) expect(have.has(id)).toBe(true);
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
      expect(url).toMatch(/^\/theme-demos\/(jewellery|fashion|grocery|general|streetwear|kirana|heroes)\/[a-z0-9-]+\.webp$/);
      expect(exists(url)).toBe(true);
      expect(credits).toContain(`| ${url.replace('/theme-demos/', '')} |`);
    }
    // Kirana reuses the grocery photos that show no brand marks, beside its own.
    const folders = id === 'kirana' ? [id, 'grocery'] : [id];
    for (const p of c.products) expect(folders.some((f) => p.image_url?.startsWith(`/theme-demos/${f}/`))).toBe(true);
  });
});
