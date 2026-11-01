import { THEME_CATALOG, type CatalogTheme } from '@/lib/store/engine/theme-catalog';
import { DEMO_CATALOGS } from '@/lib/store/engine/demo-catalogs';
import { applyHref, categoryCounts, filterThemes, popularityOrder, previewPath, themeNameFor, themeStorePaths, type ThemeSort, type ThemeTab } from '@/lib/store/engine/theme-store';

const popularity = { grocery: 9, studio: 4, heritage: 4 };
const today = '2026-11-01';
const run = (o: Partial<{ category: Parameters<typeof filterThemes>[1]['category']; tab: ThemeTab; query: string; sort: ThemeSort }> = {}) =>
  filterThemes(THEME_CATALOG, { category: 'all', tab: 'all', query: '', sort: 'popular', popularity, today, ...o }).map((t) => t.preset);

describe('filterThemes', () => {
  it('search matches name, summary, categories and features, case-insensitive and trimmed', () => {
    expect(run({ query: '  GROCERY ' })).toEqual(expect.arrayContaining(['grocery', 'quick']));
    expect(run({ query: '  GROCERY ' })).not.toContain('heritage');
    expect(run({ query: 'heritage couture' })).toEqual(['heritage']);
    expect(run({ query: 'jewellery' })).toContain('heritage');
  });

  it('every word of the search must match', () => {
    expect(run({ query: 'grocery couture' })).toEqual([]);
  });

  it('an unmatched search returns []', () => {
    expect(run({ query: 'zzzz' })).toEqual([]);
  });

  it('tabs: free hides premium, premium shows only premium, new keeps themes added in the last 90 days', () => {
    expect(run({ tab: 'free' })).not.toContain('heritage');
    expect(run({ tab: 'free' })).toHaveLength(THEME_CATALOG.length - 1);
    expect(run({ tab: 'premium' })).toEqual(['heritage']);
    expect(run({ tab: 'new' })).toEqual(['heritage']);
    expect(filterThemes(THEME_CATALOG, { category: 'all', tab: 'new', query: '', sort: 'popular', popularity, today: '2026-06-15' }).length).toBe(
      THEME_CATALOG.length,
    );
  });

  it('popular orders by popularity, ties keep list order, Blank always last', () => {
    const order = run({ sort: 'popular' });
    expect(order[0]).toBe('grocery');
    expect(order.indexOf('studio')).toBeLessThan(order.indexOf('heritage'));
    expect(order[order.length - 1]).toBe('blank');
    expect(run({ tab: 'popular', sort: 'name' })).toEqual(order);
  });

  it('name sort is alphabetical with Blank last; newest sorts by added descending', () => {
    const byName = run({ sort: 'name' });
    expect(byName[byName.length - 1]).toBe('blank');
    const names = byName.slice(0, -1).map((p) => THEME_CATALOG.find((t) => t.preset === p)!.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
    expect(run({ sort: 'newest' })[0]).toBe('heritage');
    expect(run({ sort: 'newest' }).slice(-1)).toEqual(['blank']);
  });

  it('category filter keeps themes in that category', () => {
    expect(run({ category: 'jewellery' })).toEqual(['heritage']);
    for (const p of run({ category: 'grocery' })) {
      expect((THEME_CATALOG.find((t) => t.preset === p) as CatalogTheme).categories).toContain('grocery');
    }
  });
});

describe('categoryCounts', () => {
  it('All themes first with the total, then non-empty categories in list order', () => {
    const counts = categoryCounts(THEME_CATALOG);
    expect(counts[0]).toEqual({ id: 'all', label: 'All themes', count: THEME_CATALOG.length });
    expect(counts.every((c) => c.count > 0)).toBe(true);
    expect(counts.find((c) => c.id === 'pharmacy')).toBeUndefined();
    expect(counts.find((c) => c.id === 'grocery')?.count).toBe(2);
  });
});

describe('themeNameFor', () => {
  it('uses the name, else the lowest free number, case-insensitively, within 60 characters', () => {
    expect(themeNameFor('Heritage Couture', [])).toBe('Heritage Couture');
    expect(themeNameFor('Heritage Couture', ['Heritage Couture'])).toBe('Heritage Couture 2');
    expect(themeNameFor('Heritage Couture', ['Heritage Couture', 'Heritage Couture 2', 'Heritage Couture 9'])).toBe('Heritage Couture 3');
    expect(themeNameFor('Heritage Couture', ['heritage couture'])).toBe('Heritage Couture 2');
    const long = 'x'.repeat(60);
    expect(themeNameFor(long, [long])).toHaveLength(60);
    expect(themeNameFor(long, [long]).endsWith(' 2')).toBe(true);
  });
});

describe('applyHref', () => {
  it('signed in: the app apply page; visitor: sign up, then back to it', () => {
    expect(applyHref('heritage-couture', true)).toBe('/settings/online-store/themes/apply/heritage-couture');
    expect(applyHref('heritage-couture', false)).toBe('/signup?next=/settings/online-store/themes/apply/heritage-couture');
    // The path passes signup's same-site `next` check.
    expect('/settings/online-store/themes/apply/heritage-couture').toMatch(/^\/(?!\/)[\w\-/]*$/);
  });
});

describe('popularityOrder', () => {
  it('turns counts into an order only: equal counts share a rank, no count is kept', () => {
    const order = popularityOrder({ grocery: 9, studio: 4, heritage: 4, quick: 1 });
    expect(order.grocery).toBeGreaterThan(order.studio!);
    expect(order.studio).toBe(order.heritage);
    expect(order.heritage).toBeGreaterThan(order.quick!);
    expect(Object.values(order)).not.toContain(9);
    expect(popularityOrder({})).toEqual({});
  });
});

describe('previewPath', () => {
  it('home, catalog and the first product of the theme catalogue', () => {
    expect(previewPath('home', 'jewellery')).toBe('/');
    expect(previewPath('catalog', 'grocery')).toBe('/catalog');
    expect(previewPath('product', 'jewellery')).toBe(`/products/${DEMO_CATALOGS.jewellery.products[0].id}`);
    expect(previewPath('product', 'general')).toMatch(/^\/products\/ge-/);
  });
});

describe('themeStorePaths', () => {
  it('on the website: /themes pages, and Apply through applyHref', () => {
    const p = themeStorePaths(false);
    expect(p.store).toBe('/themes');
    expect(p.detail('quick')).toBe('/themes/quick');
    expect(p.apply('quick', false)).toBe(applyHref('quick', false));
    expect(p.apply('quick', true)).toBe(applyHref('quick', true));
  });

  it('inside the app: the explore pages, and Apply always straight to the app page (the merchant is signed in)', () => {
    const p = themeStorePaths(true);
    expect(p.store).toBe('/settings/online-store/themes/explore');
    expect(p.detail('heritage-couture')).toBe('/settings/online-store/themes/explore/heritage-couture');
    expect(p.apply('heritage-couture', false)).toBe('/settings/online-store/themes/apply/heritage-couture');
  });
});
