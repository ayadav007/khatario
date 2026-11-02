// Server-side: the theme demo stores on demo-<slug> (the public theme store frames them). Built in memory from the
// theme list and the demo catalogues: no database rows, no orders, checkout off, like the old theme-* demo stores.
import { DEFAULT_STORE_PROMO } from '@/lib/store/promo-sheet';
import type { StoreBusinessContext } from '@/lib/store/resolve-store';
import { DEMO_CATALOGS } from './demo-catalogs';
import { presetTheme } from './presets';
import { THEME_CATALOG } from './theme-catalog';
import type { ThemeData } from './types';

const PREFIX = 'demo-';

/** Heritage Couture's sample pictures, swapped for the jewellery photos in its demo store. */
const HERITAGE_PICTURES: Record<string, string> = {
  'hero-1': '/theme-demos/heroes/jewellery-1.webp',
  'hero-2': '/theme-demos/jewellery/necklace-pearl.webp',
  'hero-3': '/theme-demos/jewellery/bangles-ornate.webp',
  'gallery-1': '/theme-demos/jewellery/necklace-beaded-red.webp',
  'gallery-2': '/theme-demos/jewellery/set-matching.webp',
  'gallery-3': '/theme-demos/jewellery/ring-diamond.webp',
  'gallery-4': '/theme-demos/jewellery/earrings-red.webp',
  story: '/theme-demos/heroes/jewellery-3.webp',
  look: '/theme-demos/heroes/jewellery-2.webp',
};

/** Drop Culture's sample pictures, swapped for the streetwear photos in its demo store. */
const DROP_PICTURES: Record<string, string> = {
  'hero-1': '/theme-demos/heroes/streetwear-1.webp',
  'promo-1': '/theme-demos/streetwear/promo-tees.webp',
  'promo-2': '/theme-demos/streetwear/promo-denim.webp',
  'look-1': '/theme-demos/streetwear/look-patchwork.webp',
  'gallery-1': '/theme-demos/streetwear/lookbook-1.webp',
  'gallery-2': '/theme-demos/streetwear/lookbook-2.webp',
  'gallery-3': '/theme-demos/streetwear/lookbook-3.webp',
  'gallery-4': '/theme-demos/streetwear/lookbook-4.webp',
  'category-1': '/theme-demos/streetwear/tee-boxy-white.webp',
  'category-2': '/theme-demos/streetwear/coord-navy.webp',
  'category-3': '/theme-demos/streetwear/denim-straight.webp',
};

/** The streetwear categories Drop's three category tiles show, in tile order (the preset's tiles have no category of their own). */
const DROP_TILE_CATEGORIES = ['sw-cat-tees', 'sw-cat-coords', 'sw-cat-denim'];

/** The demo store at `subdomain` (demo-<slug>, any case), or null: Blank and unknown themes have none. */
export function engineDemoStore(subdomain: string): StoreBusinessContext | null {
  const sd = subdomain.trim().toLowerCase();
  if (!sd.startsWith(PREFIX)) return null;
  const index = THEME_CATALOG.findIndex((t) => t.demo?.subdomain === sd);
  const theme = THEME_CATALOG[index];
  if (!theme?.demo) return null;
  const { brand, tagline, catalog } = theme.demo;
  return {
    // A fixed id per theme, so nothing a demo store does can reach a real business.
    business_id: `00000000-0000-4000-8000-0000000001${String(index).padStart(2, '0')}`,
    name: brand,
    logo_url: null,
    phone: null,
    email: null,
    store_subdomain: sd,
    store_tagline: tagline,
    store_hero_image_url: DEMO_CATALOGS[catalog].heroes[0],
    store_min_order_amount: 0,
    portal_theme: null,
    store_theme: null,
    store_about_md: `${brand} is a Khatario theme demo store. Its products are samples; your own appear when you use the ${theme.name} theme.`,
    store_contact_md: 'Theme demo store. Not a live shop.',
    store_privacy_md: 'Theme demo store.',
    store_refund_md: 'Theme demo store.',
    store_terms_md: 'Theme demo store.',
    store_allow_cod: false,
    store_hide_khatario_badge: false,
    online_pay_enabled: false,
    upi_pay_enabled: false,
    store_promo_sheet: { ...DEFAULT_STORE_PROMO, enabled: false },
    is_demo: true,
    demo_preset: theme.preset,
    demo_catalog: catalog,
  };
}

/** The theme a demo store draws: its preset filled with the demo brand and the catalogue's pictures. */
export function demoThemeData(store: StoreBusinessContext): ThemeData {
  const preset = store.demo_preset ?? 'studio';
  const heroes = store.demo_catalog ? DEMO_CATALOGS[store.demo_catalog].heroes : [];
  const data = presetTheme(preset, {
    businessName: store.name,
    tagline: store.store_tagline ?? '',
    heroUrl: heroes[0],
    images: preset === 'heritage' ? HERITAGE_PICTURES : preset === 'drop' ? DROP_PICTURES : undefined,
  });
  if (preset === 'drop') pointDropTilesAtCategories(data);
  return data;
}

/** Gives Drop's category tiles the streetwear categories, so each tile's picture shows in the demo store. */
function pointDropTilesAtCategories(data: ThemeData): void {
  for (const section of Object.values(data.templates.home?.sections ?? {})) {
    if (section.type !== 'category-grid') continue;
    (section.block_order ?? []).forEach((id, i) => {
      const block = section.blocks?.[id];
      if (block && DROP_TILE_CATEGORIES[i]) block.settings = { ...block.settings, category: DROP_TILE_CATEGORIES[i] };
    });
  }
}
