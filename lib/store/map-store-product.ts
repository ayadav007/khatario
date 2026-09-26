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

export { extraGalleryUrls };
