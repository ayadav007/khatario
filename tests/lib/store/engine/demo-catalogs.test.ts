import fs from 'fs';
import path from 'path';
import { DEMO_CATALOGS, demoCatalog } from '@/lib/store/engine/demo-catalogs';
import type { DemoCatalogId } from '@/lib/store/engine/theme-catalog';

const IDS: DemoCatalogId[] = ['jewellery', 'fashion', 'grocery', 'general'];
const PREFIX: Record<DemoCatalogId, string> = { jewellery: 'jw-', fashion: 'fa-', grocery: 'gr-', general: 'ge-' };
const credits = fs.readFileSync('public/theme-demos/CREDITS.md', 'utf8');
const exists = (url: string) => fs.existsSync(path.join('public', url));

describe('demo catalogues', () => {
  it('has the four catalogues', () => {
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
      expect(p.current_stock).toBe(20);
      expect(p.has_variants).toBe(false);
      expect(p.selling_price).toBeGreaterThan(0);
      if (p.mrp != null) expect(p.mrp).toBeGreaterThan(p.selling_price);
    }
    // Every category has something in it.
    for (const cat of c.categories) expect(c.products.some((p) => p.category_id === cat.id)).toBe(true);
  });

  it('ids are unique across all catalogues', () => {
    const all = IDS.flatMap((id) => DEMO_CATALOGS[id].products.map((p) => p.id));
    expect(new Set(all).size).toBe(all.length);
  });

  it.each(IDS)('%s: every photo is our own file, on disk and credited; at least two heroes', (id) => {
    const c = DEMO_CATALOGS[id];
    expect(c.heroes.length).toBeGreaterThanOrEqual(2);
    for (const url of [...c.products.map((p) => p.image_url as string), ...c.heroes]) {
      expect(url).toMatch(/^\/theme-demos\/(jewellery|fashion|grocery|general|heroes)\/[a-z0-9-]+\.webp$/);
      expect(exists(url)).toBe(true);
      expect(credits).toContain(`| ${url.replace('/theme-demos/', '')} |`);
    }
    for (const p of c.products) expect(p.image_url?.startsWith(`/theme-demos/${id}/`)).toBe(true);
  });
});
