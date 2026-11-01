// Client-safe, pure: the public theme store's search, tabs, sorting and category counts, and the name a theme
// gets when it is added to a library.
import { DEMO_CATALOGS } from './demo-catalogs';
import { THEME_CATEGORIES, type CatalogTheme, type DemoCatalogId, type ThemeCategoryId } from './theme-catalog';
import type { ThemePreset } from './types';

export type ThemeTab = 'all' | 'popular' | 'new' | 'free' | 'premium';
export type ThemeSort = 'popular' | 'newest' | 'name';

/** How recently a theme was added to count as New. */
const NEW_DAYS = 90;
const NAME_MAX = 60;

const DAY = 24 * 3600_000;
const dayNumber = (iso: string): number => Math.floor(Date.parse(`${iso}T00:00:00Z`) / DAY);

function haystack(t: CatalogTheme): string {
  const labels = t.categories.map((c) => THEME_CATEGORIES.find((x) => x.id === c)?.label ?? '');
  return [t.name, t.summary, ...labels, ...t.features].join(' ').toLowerCase();
}

/**
 * The themes to show, in order. Every search word must occur in the name, summary, category labels or features
 * (case-insensitive). The Popular tab always sorts by popularity; ties keep the list order; Blank is always last.
 */
export function filterThemes(
  list: CatalogTheme[],
  o: {
    category: ThemeCategoryId | 'all';
    tab: ThemeTab;
    query: string;
    sort: ThemeSort;
    popularity: Partial<Record<ThemePreset, number>>;
    today: string;
  },
): CatalogTheme[] {
  const words = o.query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const today = dayNumber(o.today);
  const shown = list.filter((t) => {
    if (o.category !== 'all' && !t.categories.includes(o.category)) return false;
    if (o.tab === 'free' && t.premium) return false;
    if (o.tab === 'premium' && !t.premium) return false;
    if (o.tab === 'new' && today - dayNumber(t.added) > NEW_DAYS) return false;
    if (words.length) {
      const text = haystack(t);
      if (!words.every((w) => text.includes(w))) return false;
    }
    return true;
  });
  const sort: ThemeSort = o.tab === 'popular' ? 'popular' : o.sort;
  const index = new Map(list.map((t, i) => [t.preset, i]));
  const compare = (a: CatalogTheme, b: CatalogTheme): number => {
    if (sort === 'popular') return (o.popularity[b.preset] ?? 0) - (o.popularity[a.preset] ?? 0);
    if (sort === 'newest') return b.added.localeCompare(a.added);
    return a.name.localeCompare(b.name);
  };
  return [...shown].sort((a, b) => {
    const blank = Number(a.preset === 'blank') - Number(b.preset === 'blank');
    return blank || compare(a, b) || (index.get(a.preset) ?? 0) - (index.get(b.preset) ?? 0);
  });
}

/** "All themes" with the total, then each category that has a theme, in THEME_CATEGORIES order. */
export function categoryCounts(list: CatalogTheme[]): { id: ThemeCategoryId | 'all'; label: string; count: number }[] {
  const out: { id: ThemeCategoryId | 'all'; label: string; count: number }[] = [{ id: 'all', label: 'All themes', count: list.length }];
  for (const c of THEME_CATEGORIES) {
    const count = list.filter((t) => t.categories.includes(c.id)).length;
    if (count > 0) out.push({ ...c, count });
  }
  return out;
}

/** `base`, or `base n` with the lowest free n ≥ 2 when the name is taken (case-insensitive), within 60 characters. */
export function themeNameFor(base: string, taken: string[]): string {
  const used = new Set(taken.map((n) => n.trim().toLowerCase()));
  const name = base.trim().slice(0, NAME_MAX);
  if (!used.has(name.toLowerCase())) return name;
  for (let n = 2; ; n++) {
    const suffix = ` ${n}`;
    const candidate = `${name.slice(0, NAME_MAX - suffix.length).trimEnd()}${suffix}`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
}

/** Where Apply theme goes: the app's apply page when signed in, else sign-up with a return to it. */
export function applyHref(slug: string, signedIn: boolean): string {
  const apply = `/settings/online-store/themes/apply/${slug}`;
  return signedIn ? apply : `/signup?next=${apply}`;
}

/**
 * Store counts turned into an order (higher first; equal counts share a step) so the page sends browsers the
 * Popular order without the counts themselves.
 */
export function popularityOrder(counts: Partial<Record<ThemePreset, number>>): Partial<Record<ThemePreset, number>> {
  const steps = [...new Set(Object.values(counts) as number[])].sort((a, b) => b - a);
  const out: Partial<Record<ThemePreset, number>> = {};
  for (const [preset, n] of Object.entries(counts) as [ThemePreset, number][]) out[preset] = steps.length - steps.indexOf(n);
  return out;
}

/** The demo store page a theme page shows: home, the catalog, or the catalogue's first product. */
export function previewPath(page: 'home' | 'catalog' | 'product', catalog: DemoCatalogId): string {
  if (page === 'catalog') return '/catalog';
  if (page === 'product') return `/products/${DEMO_CATALOGS[catalog].products[0].id}`;
  return '/';
}
