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

export { extraGalleryUrls };
