import { DEFAULT_STORE_PROMO } from '@/lib/store/promo-sheet';
import type { StoreBusinessContext } from '@/lib/store/resolve-store';
import { applyStorePreset, sanitizeStoreTheme, type StoreThemePack, type StoreThemePreset } from '@/lib/store/store-theme';
import type { StoreProduct } from '@/components/store/StoreProductCard';

export const THEME_DEMO_SLUGS: Record<string, { preset: Exclude<StoreThemePreset, 'custom'>; pack: StoreThemePack }> = {
  'theme-classic': { preset: 'green', pack: 'classic' },
  'theme-chowk': { preset: 'chowk', pack: 'chowk' },
  'theme-atelier': { preset: 'atelier', pack: 'atelier' },
  'theme-khatario': { preset: 'khatario', pack: 'khatario' },
  'theme-noir': { preset: 'noir', pack: 'noir' },
};

const DEMO_BUSINESS: Record<StoreThemePack, string> = {
  classic: '00000000-0000-4000-8000-000000000001',
  chowk: '00000000-0000-4000-8000-000000000002',
  atelier: '00000000-0000-4000-8000-000000000003',
  khatario: '00000000-0000-4000-8000-000000000004',
  noir: '00000000-0000-4000-8000-000000000005',
};

const STORE_LABEL: Record<StoreThemePack, string> = {
  classic: 'Classic',
  chowk: 'Chowk',
  atelier: 'Atelier',
  khatario: 'Khatario',
  noir: 'Noir',
};

export function isThemeDemoSubdomain(subdomain: string): boolean {
  return Object.prototype.hasOwnProperty.call(THEME_DEMO_SLUGS, subdomain.toLowerCase().trim());
}

export function themeDemoPack(subdomain: string): StoreThemePack | null {
  return THEME_DEMO_SLUGS[subdomain.toLowerCase().trim()]?.pack ?? null;
}

const DEMO_CATS = [
  { id: 'cat-one', name: 'New in' },
  { id: 'cat-two', name: 'Essentials' },
  { id: 'cat-three', name: 'Gifts' },
];

export function themeDemoProducts(): StoreProduct[] {
  const mk = (
    id: string,
    name: string,
    price: number,
    mrp: number | null,
    cat: string,
    catName: string,
    featured = false,
  ): StoreProduct => ({
    id,
    name,
    code: null,
    description: 'Sample product for theme preview. Checkout is disabled.',
    selling_price: price,
    mrp,
    unit: 'PCS',
    image_url: null,
    category_id: cat,
    category_name: catName,
    current_stock: 20,
    has_variants: false,
    tax_rate: 18,
    gst_included: true,
    images: [],
    rating_avg: 4.6,
    rating_count: 12,
    featured_in_store: featured,
    variants: [],
  });
  return [
    mk('demo-1', 'Merino crew', 1890, 2290, 'cat-one', 'New in', true),
    mk('demo-2', 'Linen overshirt', 2450, null, 'cat-one', 'New in', true),
    mk('demo-3', 'Everyday tote', 890, 990, 'cat-two', 'Essentials'),
    mk('demo-4', 'Cotton tee', 650, null, 'cat-two', 'Essentials'),
    mk('demo-5', 'Gift box', 1290, 1490, 'cat-three', 'Gifts'),
    mk('demo-6', 'Wool scarf', 1100, null, 'cat-three', 'Gifts'),
    mk('demo-7', 'Canvas slip-on', 3200, 3600, 'cat-two', 'Essentials'),
    mk('demo-8', 'Studio mug', 420, null, 'cat-three', 'Gifts'),
  ];
}

export function themeDemoStore(subdomain: string): StoreBusinessContext | null {
  const spec = THEME_DEMO_SLUGS[subdomain.toLowerCase().trim()];
  if (!spec) return null;
  const theme = sanitizeStoreTheme({
    ...applyStorePreset(spec.preset),
    preset: spec.preset,
    pack: spec.pack,
    hero_slides: [
      {
        image_url: '',
        title: spec.pack === 'noir' ? 'Winter Collection' : 'Welcome',
        subtitle: 'Theme preview — sample catalog, checkout off.',
        viewport: 'both',
      },
    ],
    testimonials: [
      { name: 'Asha K.', text: 'Lovely pieces and quick delivery.', photo_url: '' },
      { name: 'Rahul M.', text: 'The store looks premium and easy to shop.', photo_url: '' },
    ],
    brand_story: 'This is a preview store so you can judge the layout before you apply it to your products.',
    overlay_bands: [{ image_url: '', caption: 'New season', cta: 'Shop now' }],
    show_listing_add: true,
  });
  return {
    business_id: DEMO_BUSINESS[spec.pack],
    name: `${STORE_LABEL[spec.pack]} preview`,
    logo_url: null,
    phone: null,
    email: null,
    store_subdomain: subdomain.toLowerCase().trim(),
    store_tagline: 'Khatario theme preview',
    store_hero_image_url: null,
    store_min_order_amount: 0,
    portal_theme: null,
    store_theme: theme,
    store_about_md: 'Preview catalog. Your real products appear after you apply this theme.',
    store_contact_md: 'Preview store — not a live shop.',
    store_privacy_md: 'Preview only.',
    store_refund_md: 'Preview only.',
    store_terms_md: 'Preview only.',
    store_allow_cod: false,
    store_hide_khatario_badge: false,
    online_pay_enabled: false,
    store_promo_sheet: DEFAULT_STORE_PROMO,
    is_demo: true,
  };
}

export function filterDemoCatalog(opts: {
  categoryId?: string | null;
  search?: string | null;
  page: number;
  limit: number;
  featuredOnly?: boolean;
  discountedOnly?: boolean;
  maxPrice?: number | null;
}) {
  let items = themeDemoProducts();
  if (opts.featuredOnly) items = items.filter((i) => i.featured_in_store);
  if (opts.discountedOnly) {
    items = items.filter(
      (i) => i.mrp != null && i.mrp > i.selling_price && i.current_stock > 0,
    );
  }
  if (opts.maxPrice != null && opts.maxPrice > 0) {
    items = items.filter((i) => i.selling_price <= opts.maxPrice!);
  }
  if (opts.categoryId) items = items.filter((i) => i.category_id === opts.categoryId);
  if (opts.search) {
    const q = opts.search.toLowerCase();
    items = items.filter((i) => i.name.toLowerCase().includes(q));
  }
  const total = items.length;
  const start = (opts.page - 1) * opts.limit;
  return {
    items: items.slice(start, start + opts.limit),
    categories: DEMO_CATS,
    total,
    page: opts.page,
    limit: opts.limit,
  };
}
