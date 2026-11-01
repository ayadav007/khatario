// Client-safe: the one list of themes. The theme library's preset choices, the public theme store
// (khatario.com/themes) and each theme's demo store all read it. Imports only types.
import type { ThemePreset } from './types';

export type ThemeCategoryId = 'grocery' | 'fashion' | 'jewellery' | 'electronics' | 'home' | 'pharmacy' | 'food' | 'any';

/** The kinds of store a theme can suit, in the order the theme store lists them. */
export const THEME_CATEGORIES: { id: ThemeCategoryId; label: string }[] = [
  { id: 'grocery', label: 'Grocery & Kirana' },
  { id: 'fashion', label: 'Fashion & Apparel' },
  { id: 'jewellery', label: 'Jewellery' },
  { id: 'electronics', label: 'Electronics' },
  { id: 'home', label: 'Home & Lifestyle' },
  { id: 'pharmacy', label: 'Pharmacy & Wellness' },
  { id: 'food', label: 'Restaurants & Food' },
  { id: 'any', label: 'Any store' },
];

/** The sample catalogues demo stores draw from (lib/store/engine/demo-catalogs.ts). */
export type DemoCatalogId = 'jewellery' | 'fashion' | 'grocery' | 'general';

export interface CatalogTheme {
  preset: ThemePreset;
  /** The theme's page address: /themes/<slug>. */
  slug: string;
  name: string;
  /** One line for the theme card (and the library's choice text). */
  summary: string;
  /** Two or three sentences for the theme's page. */
  about: string;
  categories: ThemeCategoryId[];
  features: string[];
  /** The theme's main colours, shown as dots. */
  palette: [string, string, string];
  /** The preset's paper and accent (presets/look.ts; a test keeps them equal). */
  canvas: string;
  accent: string;
  premium: boolean;
  /** YYYY-MM-DD, for New. */
  added: string;
  /** The theme shown large in the theme store's hero. */
  featured?: true;
  /** Its demo store on demo-<slug>; Blank has none. */
  demo: { subdomain: string; brand: string; tagline: string; catalog: DemoCatalogId } | null;
}

export const THEME_CATALOG: CatalogTheme[] = [
  {
    preset: 'studio',
    slug: 'studio',
    name: 'Studio',
    summary: 'Editorial header, split hero and photo category tiles',
    about:
      'A calm, editorial store with a split hero, photo category tiles and roomy product cards. Suits fashion, home and lifestyle brands that sell on looks.',
    categories: ['fashion', 'home', 'any'],
    features: ['Split hero with your best photo', 'Photo category tiles', 'Roomy product cards', 'Announcement bar and menu', 'Testimonials and newsletter'],
    palette: ['#fbf8f3', '#b94717', '#1c1917'],
    canvas: '#fbf8f3',
    accent: '#b94717',
    premium: false,
    added: '2026-06-01',
    demo: { subdomain: 'demo-studio', brand: 'Studio Loom', tagline: 'Everyday clothes, made to last', catalog: 'fashion' },
  },
  {
    preset: 'quick',
    slug: 'quick',
    name: 'Quick',
    summary: 'Phone-first quick delivery with a big search and a floating cart bar',
    about:
      'Built for orders in minutes: a big search, delivery time up top, category chips and a cart bar that follows the shopper. Made for phones first.',
    categories: ['grocery', 'food'],
    features: ['Delivery time and pincode up top', 'Big search with suggestions', 'Category chips', 'Floating cart bar on phones', 'Bestsellers and deals rails'],
    palette: ['#f3f5f7', '#0f7a5c', '#111827'],
    canvas: '#f3f5f7',
    accent: '#0f7a5c',
    premium: false,
    added: '2026-06-01',
    demo: { subdomain: 'demo-quick', brand: 'QuickBasket', tagline: 'Groceries at your door in 30 minutes', catalog: 'grocery' },
  },
  {
    preset: 'grocery',
    slug: 'premium-grocery',
    name: 'Premium Grocery',
    summary: 'Fresh green supermarket with a hero card and emoji category tiles',
    about:
      'A fresh, green supermarket look with a hero card, friendly category tiles and offer rails. Suits kirana stores, supermarkets and fresh produce shops.',
    categories: ['grocery'],
    features: ['Hero card for your offer', 'Emoji category tiles', 'Deals and bestsellers rails', 'Unit and price on every card', 'Bottom tabs on phones'],
    palette: ['#f6f7f4', '#176b45', '#f2b705'],
    canvas: '#f6f7f4',
    accent: '#176b45',
    premium: false,
    added: '2026-06-01',
    demo: { subdomain: 'demo-premium-grocery', brand: 'FreshMart', tagline: 'Fresh groceries delivered to your door', catalog: 'grocery' },
  },
  {
    preset: 'khatario',
    slug: 'khatario',
    name: 'Khatario',
    summary: 'Brand header, carousel and bottom tabs',
    about:
      'A clean, all-round store with a brand header, a picture carousel and bottom tabs on phones. A safe start for electronics, general stores and any shop.',
    categories: ['any', 'electronics'],
    features: ['Brand header with search', 'Picture carousel', 'Category grid', 'Bottom tabs on phones', 'Works for any catalogue'],
    palette: ['#f4f5f7', '#00897b', '#1f2937'],
    canvas: '#f4f5f7',
    accent: '#00897b',
    premium: false,
    added: '2026-06-01',
    demo: { subdomain: 'demo-khatario', brand: 'Kartik Electronics', tagline: 'Gadgets and home appliances', catalog: 'general' },
  },
  {
    preset: 'blank',
    slug: 'blank',
    name: 'Blank',
    summary: 'An empty page to build from scratch',
    about: 'A header, a footer and nothing in between, for building your store section by section.',
    categories: ['any'],
    features: ['Header and footer only', 'Add any section', 'Your colours and fonts', 'Nothing to remove first'],
    palette: ['#fbf8f3', '#b94717', '#1c1917'],
    canvas: '#fbf8f3',
    accent: '#b94717',
    premium: false,
    added: '2026-06-01',
    demo: null,
  },
  {
    preset: 'heritage',
    slug: 'heritage-couture',
    name: 'Heritage Couture',
    summary: 'Ivory, crimson and gold with serif headings, for fashion, couture and jewellery',
    about:
      'An ivory, crimson and gold boutique with serif headings, a photo collage, shop-the-look and royal product cards. Made for jewellery, bridal and couture stores. Comes with sample pictures to replace with yours.',
    categories: ['jewellery', 'fashion'],
    features: ['Serif headings in ivory, crimson and gold', 'Photo collage hero', 'Shop the look', 'Royal product cards', 'Image gallery and press mentions', 'Sample pictures included'],
    palette: ['#fcf9f3', '#7a0c1e', '#c9a46a'],
    canvas: '#fcf9f3',
    accent: '#7a0c1e',
    premium: true,
    added: '2026-10-31',
    featured: true,
    demo: { subdomain: 'demo-heritage-couture', brand: 'Aarna Jewels', tagline: 'Timeless jewellery for every occasion', catalog: 'jewellery' },
  },
];

/** The theme at /themes/<slug> (exact, lower-case slug), or null. */
export function catalogTheme(slug: string): CatalogTheme | null {
  return THEME_CATALOG.find((t) => t.slug === slug) ?? null;
}

/** Every preset is in the list (a test keeps it so). */
export function catalogThemeByPreset(preset: ThemePreset): CatalogTheme {
  return THEME_CATALOG.find((t) => t.preset === preset) ?? THEME_CATALOG[0];
}
