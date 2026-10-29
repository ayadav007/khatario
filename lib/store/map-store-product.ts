import { extraGalleryUrls, sanitizeGalleryUrls } from '@/lib/store/item-gallery';

export function storeProductImages(imageUrl: unknown, galleryUrls: unknown): string[] {
  return sanitizeGalleryUrls(galleryUrls, imageUrl);
}

export function parseRatingAvg(raw: unknown): number {
  const n = parseFloat(String(raw ?? '0'));
  return Number.isFinite(n) ? Math.round(n * 10) / 10 : 0;
}

export function parseRatingCount(raw: unknown): number {
  const n = parseInt(String(raw ?? '0'), 10);
  return Number.isFinite(n) ? n : 0;
}

export function parseStoreMoney(raw: unknown): number | null {
  if (raw == null || raw === '') return null;
  const n = typeof raw === 'number' ? raw : parseFloat(String(raw));
  return Number.isFinite(n) ? n : null;
}

export function storeDiscountPercent(mrp: unknown, sellingPrice: unknown): number {
  const listed = parseStoreMoney(mrp);
  const selling = parseStoreMoney(sellingPrice);
  if (listed == null || selling == null || listed <= selling) return 0;
  return Math.round(((listed - selling) / listed) * 100);
}

export function isStoreOfferItem(item: {
  mrp?: unknown;
  selling_price?: unknown;
  current_stock?: unknown;
}): boolean {
  const stock = parseStoreMoney(item.current_stock) ?? 0;
  return storeDiscountPercent(item.mrp, item.selling_price) > 0 && stock > 0;
}

/** Items added to the catalog in the last 30 days get a "New" badge. */
export const NEW_ARRIVAL_DAYS = 30;
/** At or below this many units (and above zero) a card says "Only N left". */
export const LOW_STOCK_THRESHOLD = 5;

export function isNewArrival(createdAt: string | null | undefined, now: number = Date.now()): boolean {
  if (!createdAt) return false;
  const t = Date.parse(createdAt);
  if (!Number.isFinite(t)) return false;
  return now - t >= 0 && now - t <= NEW_ARRIVAL_DAYS * 86_400_000;
}

export function lowStockCount(item: { current_stock?: unknown; has_variants?: boolean }): number | undefined {
  if (item.has_variants) return undefined;
  const stock = parseStoreMoney(item.current_stock) ?? 0;
  return stock > 0 && stock <= LOW_STOCK_THRESHOLD ? Math.floor(stock) || undefined : undefined;
}

export interface StoreItem {
  id: string;
  name: string;
  code: string | null;
  description: string | null;
  selling_price: number;
  mrp: number | null;
  unit: string;
  image_url: string | null;
  category_id: string | null;
  category_name: string | null;
  brand: string | null;
  current_stock: number;
  has_variants: boolean;
  tax_rate: number;
  gst_included: boolean;
  images: string[];
  rating_avg: number;
  rating_count: number;
  featured_in_store?: boolean;
  created_at: string | null;
  sold_count: number;
  variants: Array<{
    id: string;
    variant_name: string;
    selling_price: number;
    current_stock: number;
    attributes: unknown;
  }>;
}

/** Maps a row from `buildStoreItemsQuery().listSql` to the public store item shape. */
export function mapStoreItemRow(r: Record<string, unknown>): StoreItem {
  return {
    id: r.id as string,
    name: r.name as string,
    code: (r.code as string) ?? null,
    description: (r.description as string) ?? null,
    selling_price: parseFloat(r.selling_price as string) || 0,
    mrp: r.mrp ? parseFloat(r.mrp as string) : null,
    unit: (r.unit as string) || 'PCS',
    image_url: (r.image_url as string) ?? null,
    images: storeProductImages(r.image_url, r.gallery_urls),
    rating_avg: parseRatingAvg(r.rating_avg),
    rating_count: parseRatingCount(r.rating_count),
    category_id: (r.category_id as string) ?? null,
    category_name: (r.category_name as string) ?? null,
    brand: (r.brand as string) ?? null,
    current_stock: parseFloat(r.current_stock as string) || 0,
    has_variants: r.has_variants as boolean,
    featured_in_store: !!(r as { featured_in_store?: boolean }).featured_in_store,
    tax_rate: parseFloat(r.tax_rate as string) || 0,
    gst_included: !!(r as { gst_included?: boolean }).gst_included,
    created_at: r.created_at ? new Date(r.created_at as string).toISOString() : null,
    sold_count: parseFloat(r.sold_count as string) || 0,
    variants: Array.isArray(r.variants) ? r.variants : [],
  };
}

export { extraGalleryUrls };
