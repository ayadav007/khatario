import { DEMO_CATALOGS } from '@/lib/store/engine/demo-catalogs';
import { demoThemeData, engineDemoStore } from '@/lib/store/engine/demo-stores';
import { demoCatalogOptions, filterDemoCatalog, themeDemoProducts, themeDemoStore } from '@/lib/store/theme-demo';
import { isReservedStoreSubdomain, reservedStoreUrlChange } from '@/lib/store/resolve-store';
import type { StoreBusinessContext } from '@/lib/store/resolve-store';

jest.mock('@/lib/db', () => ({ queryOne: jest.fn(), queryRows: jest.fn(), query: jest.fn(), getPool: jest.fn() }));

describe('engineDemoStore', () => {
  it('builds the Heritage Couture demo store as Aarna Jewels', () => {
    const s = engineDemoStore('demo-heritage-couture')!;
    expect(s).toMatchObject({
      name: 'Aarna Jewels',
      store_subdomain: 'demo-heritage-couture',
      is_demo: true,
      demo_preset: 'heritage',
      demo_catalog: 'jewellery',
      store_allow_cod: false,
      online_pay_enabled: false,
      upi_pay_enabled: false,
    });
    expect(s.store_promo_sheet.enabled).toBe(false);
    expect(s.business_id).toMatch(/^00000000-0000-4000-8000-0000000001\d\d$/);
  });

  it('ignores case and whitespace, and gives each theme its own business id', () => {
    expect(engineDemoStore('  DEMO-Premium-Grocery ')?.name).toBe('FreshMart');
    expect(engineDemoStore('demo-quick')?.business_id).not.toBe(engineDemoStore('demo-premium-grocery')?.business_id);
  });

  it('is null for Blank, unknown themes and addresses without the prefix', () => {
    expect(engineDemoStore('demo-blank')).toBeNull();
    expect(engineDemoStore('demo-nope')).toBeNull();
    expect(engineDemoStore('heritage-couture')).toBeNull();
    expect(engineDemoStore('theme-studio')).toBeNull();
  });
});

describe('demoThemeData', () => {
  it('Heritage uses the jewellery photos instead of its pattern pictures', () => {
    const data = demoThemeData(engineDemoStore('demo-heritage-couture')!);
    const json = JSON.stringify(data.templates.home);
    expect(json).toContain('/theme-demos/');
    expect(json).not.toContain('/store-presets/heritage/hero-1.svg');
    expect(json).toContain('Welcome to Aarna Jewels');
  });

  it('draws the drop demo store', () => {
    const store = engineDemoStore('demo-drop-culture')!;
    expect(store).toMatchObject({ name: 'VOLTX', demo_preset: 'drop', demo_catalog: 'streetwear', store_tagline: 'Drops every Friday' });
    const data = demoThemeData(store);
    const home = JSON.stringify(data.templates.home);
    expect(data.settings.color_schemes.map((c) => c.name)).toEqual(['Ink', 'Concrete', 'Bone', 'Volt', 'Alarm', 'Smoke']);
    expect(data.settings.color_schemes[3].background).toBe('#d4ff3a');
    expect(home).toContain('/theme-demos/heroes/streetwear-1.webp');
    expect(home).toContain('/theme-demos/streetwear/lookbook-1.webp');
    expect(home).not.toContain('/store-presets/drop/');
    expect(home).not.toContain('/store-presets/heritage/');
    // The three category tiles point at real streetwear categories, so their pictures show.
    const grid = Object.values(data.templates.home.sections).find((s) => s.type === 'category-grid')!;
    const tiles = (grid.block_order ?? []).map((id) => grid.blocks![id].settings);
    expect(tiles.map((t) => t.category)).toEqual(['sw-cat-tees', 'sw-cat-coords', 'sw-cat-denim']);
    const ids = new Set(DEMO_CATALOGS.streetwear.categories.map((c) => c.id));
    for (const t of tiles) {
      expect(ids.has(t.category as string)).toBe(true);
      expect(String(t.image)).toMatch(/^\/theme-demos\/streetwear\/[a-z-]+\.webp$/);
    }
  });

  it('a slideshow theme gets the catalogue hero and the brand name', () => {
    const json = JSON.stringify(demoThemeData(engineDemoStore('demo-premium-grocery')!));
    expect(json).toContain('/theme-demos/heroes/grocery-1.webp');
    expect(json).toContain('FreshMart');
  });
});

describe('demo catalogue routing', () => {
  const heritage = engineDemoStore('demo-heritage-couture') as StoreBusinessContext;

  it('a demo store reads only its own catalogue', () => {
    expect(demoCatalogOptions(heritage)).toEqual({ pack: undefined, catalog: 'jewellery' });
    const r = filterDemoCatalog({ ...demoCatalogOptions(heritage), page: 1, limit: 50 });
    expect(r.items.length).toBeGreaterThan(0);
    expect(r.items.every((i) => i.id.startsWith('jw-'))).toBe(true);
    expect(r.categories.every((c) => c.id.startsWith('jw-'))).toBe(true);
  });

  it("another theme's demo product is not in this store's list", () => {
    expect(themeDemoProducts(undefined, 'grocery').some((p) => p.id.startsWith('jw-'))).toBe(false);
    expect(themeDemoProducts(undefined, 'grocery').find((p) => p.id === 'jw-3')).toBeUndefined();
  });

  it('the old theme-* demo stores are unchanged', () => {
    const old = themeDemoStore('theme-studio')!;
    expect(old.demo_catalog).toBeUndefined();
    expect(demoCatalogOptions(old)).toEqual({ pack: 'studio', catalog: undefined });
    expect(themeDemoProducts().some((p) => p.id === 'demo-1')).toBe(true);
    expect(filterDemoCatalog({ pack: 'grocery', page: 1, limit: 50 }).items.every((i) => i.id.startsWith('grocery-'))).toBe(true);
  });
});

describe('isReservedStoreSubdomain', () => {
  it('reserves demo-* but not words that merely start with demo', () => {
    expect(isReservedStoreSubdomain('demo-abc')).toBe(true);
    expect(isReservedStoreSubdomain('DEMO-abc')).toBe(true);
    expect(isReservedStoreSubdomain('demolition')).toBe(false);
    expect(isReservedStoreSubdomain('theme-studio')).toBe(true);
    expect(isReservedStoreSubdomain('shalinitraders')).toBe(false);
  });
});

describe('reservedStoreUrlChange', () => {
  it('blocks moving to a reserved URL but lets a store keep the one it already has', () => {
    expect(reservedStoreUrlChange('demo-abc', null)).toBe(true);
    expect(reservedStoreUrlChange('demo-abc', 'shalinitraders')).toBe(true);
    expect(reservedStoreUrlChange('demo-abc', 'demo-abc')).toBe(false);
    expect(reservedStoreUrlChange('demo-abc', ' Demo-ABC ')).toBe(false);
    expect(reservedStoreUrlChange('www', null)).toBe(true);
    expect(reservedStoreUrlChange('shalinitraders', null)).toBe(false);
  });
});
