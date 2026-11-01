// Client-safe: the sample catalogues the theme demo stores (demo-<slug>) draw from. Photos are stock photos kept in
// our own files under public/theme-demos/ (credited in public/theme-demos/CREDITS.md; scripts/theme-demo-photos.mjs).
import type { StoreProduct } from '@/components/store/StoreProductCard';
import type { DemoCatalogId } from './theme-catalog';

export type { DemoCatalogId } from './theme-catalog';

export interface DemoCatalog {
  categories: { id: string; name: string }[];
  products: StoreProduct[];
  /** Wide pictures for the demo store's hero and the theme's sample pictures. */
  heroes: string[];
}

const pic = (folder: string, file: string) => `/theme-demos/${folder}/${file}.webp`;

type Row = [id: string, name: string, price: number, mrp: number | null, category: string, file: string, extra?: Partial<StoreProduct>];

function catalog(folder: DemoCatalogId, categories: { id: string; name: string }[], rows: Row[], heroes: string[]): DemoCatalog {
  const nameOf = (id: string) => categories.find((c) => c.id === id)?.name ?? null;
  const products = rows.map(([id, name, price, mrp, category, file, extra], i): StoreProduct => ({
    id,
    name,
    code: null,
    description: 'Sample product in a Khatario theme demo store. Checkout is off.',
    selling_price: price,
    mrp,
    unit: 'PCS',
    image_url: pic(folder, file),
    category_id: category,
    category_name: nameOf(category),
    current_stock: 20,
    has_variants: false,
    tax_rate: folder === 'grocery' ? 5 : 3,
    gst_included: true,
    images: [],
    // A spread of believable ratings, the same every time.
    rating_avg: [4.8, 4.6, 4.9, 4.4, 4.7, 4.2, 4.5][i % 7],
    rating_count: 8 + ((i * 17) % 90),
    featured_in_store: i < 8,
    store_badge: null,
    store_tagline: null,
    store_swatches: [],
    variants: [],
    ...extra,
  }));
  return { categories, products, heroes: heroes.map((h) => pic('heroes', h)) };
}

const JEWELLERY = catalog(
  'jewellery',
  [
    { id: 'jw-cat-necklaces', name: 'Necklaces' },
    { id: 'jw-cat-rings', name: 'Rings' },
    { id: 'jw-cat-earrings', name: 'Earrings' },
    { id: 'jw-cat-bangles', name: 'Bangles' },
    { id: 'jw-cat-bridal', name: 'Bridal sets' },
  ],
  [
    ['jw-1', 'Temple gold necklace', 84500, 92000, 'jw-cat-necklaces', 'necklace-beaded-purple', { store_badge: 'Bestseller', store_tagline: '22K gold, handcrafted' }],
    ['jw-2', 'Kundan pendant', 18900, null, 'jw-cat-necklaces', 'pendant-gold'],
    ['jw-3', 'Rope chain', 32400, null, 'jw-cat-necklaces', 'chain-gold', { store_tagline: '22K gold, 20 inches' }],
    ['jw-4', 'Antique haar', 126000, 138000, 'jw-cat-necklaces', 'necklace-beaded-red'],
    ['jw-5', 'Pearl drop necklace', 58900, null, 'jw-cat-necklaces', 'necklace-pearl', { store_badge: 'New' }],
    ['jw-6', 'Solitaire ring', 46500, null, 'jw-cat-rings', 'ring-gold', { store_tagline: 'Certified diamond' }],
    ['jw-7', 'Stacking ring set', 21800, 24500, 'jw-cat-rings', 'rings-box'],
    ['jw-8', 'Floral diamond ring', 38200, null, 'jw-cat-rings', 'ring-diamond'],
    ['jw-9', 'Amethyst cocktail ring', 27600, null, 'jw-cat-rings', 'ring-gemstone'],
    ['jw-10', 'Ruby jhumkas', 24900, 27900, 'jw-cat-earrings', 'earrings-red', { store_badge: 'Bestseller' }],
    ['jw-11', 'Gold teardrop studs', 12400, null, 'jw-cat-earrings', 'earrings-gold'],
    ['jw-12', 'Filigree drops', 15800, null, 'jw-cat-earrings', 'earrings-drop'],
    ['jw-13', 'Carved bangle stack', 68400, null, 'jw-cat-bangles', 'bangles-ornate', { store_tagline: 'Set of six' }],
    ['jw-14', 'Twisted kadas', 41200, 45000, 'jw-cat-bangles', 'bracelets-velvet'],
    ['jw-15', 'Diamond bracelet', 52300, null, 'jw-cat-bangles', 'bracelet-diamond'],
    ['jw-16', 'Bridal necklace set', 189000, 205000, 'jw-cat-bridal', 'set-stands', { store_badge: 'Bridal' }],
    ['jw-17', 'Necklace and earring set', 96500, null, 'jw-cat-bridal', 'set-matching'],
  ],
  ['jewellery-1', 'jewellery-2', 'jewellery-3'],
);

const FASHION = catalog(
  'fashion',
  [
    { id: 'fa-cat-new', name: 'New in' },
    { id: 'fa-cat-tops', name: 'Tops' },
    { id: 'fa-cat-footwear', name: 'Footwear' },
    { id: 'fa-cat-accessories', name: 'Accessories' },
  ],
  [
    ['fa-1', 'Merino knit top', 1890, 2290, 'fa-cat-new', 'merino-crew', { store_tagline: 'Soft, breathable merino' }],
    ['fa-2', 'Everyday cotton tee', 690, null, 'fa-cat-tops', 'cotton-tee', { store_badge: 'Bestseller' }],
    ['fa-3', 'Woven tote', 2450, null, 'fa-cat-accessories', 'tote'],
    ['fa-4', 'Gift box', 990, null, 'fa-cat-accessories', 'gift-box'],
    ['fa-5', 'Canvas low-tops', 1690, 1990, 'fa-cat-footwear', 'slip-on'],
    ['fa-6', 'White leather sneakers', 3290, null, 'fa-cat-footwear', 'sneakers-white', { store_badge: 'New' }],
    ['fa-7', 'Tee and boots edit', 4990, null, 'fa-cat-new', 'tee-boots'],
    ['fa-8', 'Rust knit set', 3490, 3990, 'fa-cat-new', 'knit-set'],
    ['fa-9', 'Denim and belt', 2790, null, 'fa-cat-new', 'jeans-belt'],
    ['fa-10', 'V-neck tee pack', 1490, 1790, 'fa-cat-tops', 'vneck-shirts', { store_tagline: 'Pack of three' }],
    ['fa-11', 'Cardigan outfit', 3990, null, 'fa-cat-tops', 'cardigan-outfit'],
    ['fa-12', 'Blush pouch', 1290, null, 'fa-cat-accessories', 'pouch'],
  ],
  ['fashion-1', 'fashion-2'],
);

const GROCERY = catalog(
  'grocery',
  [
    { id: 'gr-cat-veg', name: 'Vegetables' },
    { id: 'gr-cat-fruit', name: 'Fruits' },
    { id: 'gr-cat-dairy', name: 'Dairy & Eggs' },
    { id: 'gr-cat-snacks', name: 'Snacks & Drinks' },
    { id: 'gr-cat-staples', name: 'Staples & Spices' },
  ],
  [
    ['gr-1', 'Tomatoes, 1 kg', 40, 52, 'gr-cat-veg', 'tomatoes', { unit: 'KG' }],
    ['gr-2', 'Bananas, 1 dozen', 60, null, 'gr-cat-fruit', 'bananas', { unit: 'DOZ', store_badge: 'Fresh today' }],
    ['gr-3', 'Toned milk, 1 L', 58, null, 'gr-cat-dairy', 'milk'],
    ['gr-4', 'Brown eggs, 6 pcs', 72, 84, 'gr-cat-dairy', 'eggs'],
    ['gr-5', 'Potato chips', 30, null, 'gr-cat-snacks', 'chips'],
    ['gr-6', 'Orange juice, 1 L', 125, 150, 'gr-cat-snacks', 'orange-juice'],
    ['gr-7', 'Basmati rice, 5 kg', 549, 640, 'gr-cat-staples', 'rice', { store_badge: 'Deal' }],
    ['gr-8', 'Red apples, 1 kg', 180, null, 'gr-cat-fruit', 'apples', { unit: 'KG' }],
    ['gr-9', 'Spinach bunch', 25, null, 'gr-cat-veg', 'spinach'],
    ['gr-10', 'Fruit yogurt cups', 90, 110, 'gr-cat-dairy', 'yogurt'],
    ['gr-11', 'Mosambi, 1 kg', 85, null, 'gr-cat-fruit', 'limes', { unit: 'KG' }],
    ['gr-12', 'Veggie basket', 199, 249, 'gr-cat-veg', 'vegetables'],
    ['gr-13', 'Red chilli powder, 200 g', 68, null, 'gr-cat-staples', 'spice-powders'],
    ['gr-14', 'Masala jar set', 349, 399, 'gr-cat-staples', 'spice-jars'],
  ],
  ['grocery-1', 'grocery-2'],
);

const GENERAL = catalog(
  'general',
  [
    { id: 'ge-cat-audio', name: 'Audio' },
    { id: 'ge-cat-mobiles', name: 'Mobiles & Tablets' },
    { id: 'ge-cat-accessories', name: 'Accessories' },
    { id: 'ge-cat-kitchen', name: 'Kitchen' },
    { id: 'ge-cat-home', name: 'Home appliances' },
  ],
  [
    ['ge-1', 'Wireless headphones', 4999, 6999, 'ge-cat-audio', 'headphones-flatlay', { store_badge: 'Bestseller' }],
    ['ge-2', 'Noise-cancelling headphones', 12990, null, 'ge-cat-audio', 'headphones-black'],
    ['ge-3', 'Studio headphones', 3499, null, 'ge-cat-audio', 'headphones-orange'],
    ['ge-4', 'True wireless earbuds', 2299, 2999, 'ge-cat-audio', 'earbuds'],
    ['ge-5', 'Smartwatch', 8999, null, 'ge-cat-accessories', 'smartwatch', { store_badge: 'New' }],
    ['ge-6', 'Tablet 11 inch', 32999, 36999, 'ge-cat-mobiles', 'tablet'],
    ['ge-7', 'Wireless mouse', 1199, null, 'ge-cat-accessories', 'mouse'],
    ['ge-8', 'Gaming controller kit', 4499, null, 'ge-cat-accessories', 'gaming'],
    ['ge-9', 'Smartphones', 18999, 21999, 'ge-cat-mobiles', 'phones', { store_tagline: 'Six colours' }],
    ['ge-10', 'Coffee grinder', 5499, null, 'ge-cat-kitchen', 'coffee-grinder'],
    ['ge-11', 'Espresso machine', 24990, 27990, 'ge-cat-kitchen', 'coffee-maker'],
    ['ge-12', 'Steam iron', 1899, null, 'ge-cat-home', 'iron'],
    ['ge-13', 'Front-load washing machine', 31990, 35990, 'ge-cat-home', 'washing-machine', { store_badge: 'Deal' }],
    ['ge-14', 'Built-in oven', 27990, null, 'ge-cat-kitchen', 'oven'],
  ],
  ['general-1', 'general-2'],
);

export const DEMO_CATALOGS: Record<DemoCatalogId, DemoCatalog> = {
  jewellery: JEWELLERY,
  fashion: FASHION,
  grocery: GROCERY,
  general: GENERAL,
};

export function demoCatalog(id: DemoCatalogId): DemoCatalog {
  return DEMO_CATALOGS[id];
}
