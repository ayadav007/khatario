import { DEFAULT_STORE_PROMO } from '@/lib/store/promo-sheet';
import type { StoreBusinessContext } from '@/lib/store/resolve-store';
import { DEFAULT_HOMEPAGE_SECTIONS, applyStorePreset, sanitizeStoreTheme, type StoreThemePack, type StoreThemePreset } from '@/lib/store/store-theme';
import type { StoreProduct } from '@/components/store/StoreProductCard';

export const THEME_DEMO_SLUGS: Record<string, { preset: Exclude<StoreThemePreset, 'custom'>; pack: StoreThemePack }> = {
  'theme-studio': { preset: 'studio', pack: 'studio' },
  'theme-khatario': { preset: 'khatario', pack: 'khatario' },
  'theme-grocery': { preset: 'grocery', pack: 'grocery' },
};

const DEMO_BUSINESS: Record<StoreThemePack, string> = {
  studio: '00000000-0000-4000-8000-000000000001',
  khatario: '00000000-0000-4000-8000-000000000004',
  grocery: '00000000-0000-4000-8000-000000000007',
};

const STORE_LABEL: Record<StoreThemePack, string> = {
  studio: 'Studio',
  khatario: 'Khatario',
  grocery: 'Premium Grocery',
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

const GROCERY_CATS = [
  { id: 'g-veg', name: 'Vegetables' },
  { id: 'g-fruit', name: 'Fruits' },
  { id: 'g-dairy', name: 'Dairy & Eggs' },
  { id: 'g-snacks', name: 'Snacks' },
  { id: 'g-drinks', name: 'Beverages' },
  { id: 'g-staples', name: 'Staples' },
];

function mk(
  id: string,
  name: string,
  price: number,
  mrp: number | null,
  cat: string,
  catName: string,
  featured = false,
  image: string | null = null,
  unit = 'PCS',
): StoreProduct {
  return {
    id,
    name,
    code: null,
    description: 'Sample product for theme preview. Checkout is disabled.',
    selling_price: price,
    mrp,
    unit,
    image_url: image,
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
  };
}

function apparelDemoProducts(): StoreProduct[] {
  return [
    mk('demo-1', 'Merino crew', 1890, 2290, 'cat-one', 'New in', true, 'https://images.unsplash.com/photo-1434389677669-e08b4cac3105?auto=format&fit=crop&w=900&q=80'),
    mk('demo-2', 'Linen overshirt', 2450, null, 'cat-one', 'New in', true, 'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?auto=format&fit=crop&w=900&q=80'),
    mk('demo-3', 'Everyday tote', 890, 990, 'cat-two', 'Essentials', false, 'https://images.unsplash.com/photo-1590874103328-eac38a683ce7?auto=format&fit=crop&w=900&q=80'),
    mk('demo-4', 'Cotton tee', 650, null, 'cat-two', 'Essentials', false, 'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?auto=format&fit=crop&w=900&q=80'),
    mk('demo-5', 'Gift box', 1290, 1490, 'cat-three', 'Gifts', false, 'https://images.unsplash.com/photo-1549465220-1a8b9238cd48?auto=format&fit=crop&w=900&q=80'),
    mk('demo-6', 'Wool scarf', 1100, null, 'cat-three', 'Gifts', false, 'https://images.unsplash.com/photo-1520903920243-00d872a2d1c9?auto=format&fit=crop&w=900&q=80'),
    mk('demo-7', 'Canvas slip-on', 3200, 3600, 'cat-two', 'Essentials', false, 'https://images.unsplash.com/photo-1525966222134-fcfa99b8ae77?auto=format&fit=crop&w=900&q=80'),
    mk('demo-8', 'Studio mug', 420, null, 'cat-three', 'Gifts', false, 'https://images.unsplash.com/photo-1514228742587-6b1558fcca3d?auto=format&fit=crop&w=900&q=80'),
  ];
}

function groceryDemoProducts(): StoreProduct[] {
  return [
    mk('grocery-1', 'Fresh Tomatoes', 34, 45, 'g-veg', 'Vegetables', true, 'https://images.unsplash.com/photo-1546094096-0df4bcaaa337?auto=format&fit=crop&w=600&q=80', 'KG'),
    mk('grocery-2', 'Organic Bananas', 49, 60, 'g-fruit', 'Fruits', true, 'https://images.unsplash.com/photo-1571771894821-ce9b6c11b08e?auto=format&fit=crop&w=600&q=80', 'DOZ'),
    mk('grocery-3', 'Farm Fresh Milk 1L', 64, null, 'g-dairy', 'Dairy & Eggs', false, 'https://images.unsplash.com/photo-1563636619-e9143da7973b?auto=format&fit=crop&w=600&q=80', 'LTR'),
    mk('grocery-4', 'Brown Eggs (6 pcs)', 72, 84, 'g-dairy', 'Dairy & Eggs', false, 'https://images.unsplash.com/photo-1582722872445-44dc5f7e3c8f?auto=format&fit=crop&w=600&q=80'),
    mk('grocery-5', 'Crunchy Potato Chips', 30, null, 'g-snacks', 'Snacks', false, 'https://images.unsplash.com/photo-1566478989037-eec170784d0b?auto=format&fit=crop&w=600&q=80'),
    mk('grocery-6', 'Cold Pressed Orange Juice', 120, 150, 'g-drinks', 'Beverages', true, 'https://images.unsplash.com/photo-1600271886742-f049cd451bba?auto=format&fit=crop&w=600&q=80', 'BTL'),
    mk('grocery-7', 'Basmati Rice 5kg', 549, 649, 'g-staples', 'Staples', false, 'https://images.unsplash.com/photo-1586201375761-83865001e31c?auto=format&fit=crop&w=600&q=80'),
    mk('grocery-8', 'Red Apples', 180, 220, 'g-fruit', 'Fruits', false, 'https://images.unsplash.com/photo-1560806887-1e4cd0b6cbd6?auto=format&fit=crop&w=600&q=80', 'KG'),
    mk('grocery-9', 'Baby Spinach', 40, null, 'g-veg', 'Vegetables', false, 'https://images.unsplash.com/photo-1576045057995-568f588f82fb?auto=format&fit=crop&w=600&q=80'),
    mk('grocery-10', 'Greek Yogurt', 95, 110, 'g-dairy', 'Dairy & Eggs', false, 'https://images.unsplash.com/photo-1488477181946-6428a0291777?auto=format&fit=crop&w=600&q=80'),
  ];
}

/** Every demo product across all packs, for id lookups on detail routes. */
export function themeDemoProducts(pack?: StoreThemePack | null): StoreProduct[] {
  if (pack === 'grocery') return groceryDemoProducts();
  if (pack) return apparelDemoProducts();
  return [...apparelDemoProducts(), ...groceryDemoProducts()];
}

export function themeDemoStore(subdomain: string): StoreBusinessContext | null {
  const spec = THEME_DEMO_SLUGS[subdomain.toLowerCase().trim()];
  if (!spec) return null;
  const presetTheme = applyStorePreset(spec.preset);
  const grocery = spec.pack === 'grocery';
  const theme = sanitizeStoreTheme({
    ...presetTheme,
    preset: spec.preset,
    pack: spec.pack,
    hero_slides: [
      {
        image_url: spec.pack === 'studio' ? 'https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=1400&q=80' : '',
        title: grocery ? 'Fresh groceries, delivered fast.' : 'Welcome',
        subtitle: 'Theme preview — sample catalog, checkout off.',
        viewport: 'both',
      },
    ],
    testimonials: [
      { name: 'Asha K.', text: 'Lovely pieces and quick delivery.', photo_url: '' },
      { name: 'Rahul M.', text: 'The store looks premium and easy to shop.', photo_url: '' },
    ],
    brand_story: 'This is a preview store so you can judge the layout before you apply it to your products.',
    overlay_bands: grocery
      ? [
          { image_url: '', caption: 'Stock up on pantry essentials', cta: 'Shop staples' },
          { image_url: '', caption: 'Fresh fruit, picked every morning', cta: 'Shop fruits' },
        ]
      : [{ image_url: '', caption: 'New season', cta: 'Shop now' }],
    announcement: grocery
      ? 'Theme preview  ·  Fresh fruits & vegetables  ·  Everyday essentials  ·  Checkout disabled'
      : spec.pack === 'studio'
        ? 'Theme preview · Checkout disabled'
        : undefined,
    homepage_sections:
      spec.pack === 'studio'
        ? DEFAULT_HOMEPAGE_SECTIONS.map((s) => (s.id === 'overlay' || s.id === 'testimonials' ? { ...s, enabled: true } : s))
        : presetTheme.homepage_sections,
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
    upi_pay_enabled: false,
    store_promo_sheet: DEFAULT_STORE_PROMO,
    is_demo: true,
  };
}

export function filterDemoCatalog(opts: {
  pack?: StoreThemePack | null;
  categoryId?: string | null;
  search?: string | null;
  page: number;
  limit: number;
  featuredOnly?: boolean;
  discountedOnly?: boolean;
  maxPrice?: number | null;
}) {
  const grocery = opts.pack === 'grocery';
  const all = grocery ? groceryDemoProducts() : apparelDemoProducts();
  const categories = (grocery ? GROCERY_CATS : DEMO_CATS).map((c) => ({
    ...c,
    item_count: all.filter((i) => i.category_id === c.id).length,
  }));
  let items = all;
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
    categories,
    total,
    page: opts.page,
    limit: opts.limit,
  };
}
