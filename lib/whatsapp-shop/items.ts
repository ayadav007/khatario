import crypto from 'crypto';
import { queryOne, queryRows } from '@/lib/db';
import { storePublicHostname } from '@/lib/store/subdomain';
import type { ShopSettings } from './settings';

export type ShopItem = {
  id: string;
  name: string;
  description: string | null;
  price: number;
  mrp: number | null;
  unit: string | null;
  categoryName: string | null;
  inStock: boolean;
  /** Raw `items.image_url`: a data URL, an absolute URL or an app-relative path. */
  imageSource: string | null;
};

/** Upper bound on items one shop exposes; Meta and the cart page both stay responsive below it. */
export const SHOP_ITEMS_MAX = 1000;

export function appBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || 'https://khatario.com').replace(/\/+$/, '');
}

/**
 * Items the WhatsApp shop sells: active, not deleted, priced above zero and without variants
 * (a cart line has no way to pick a variant). Scope and stock follow the shop settings.
 */
export async function loadShopItems(
  businessId: string,
  settings: Pick<ShopSettings, 'itemScope' | 'hideOutOfStock'>,
  opts: { ids?: string[] } = {},
): Promise<ShopItem[]> {
  const params: unknown[] = [businessId];
  const where = [
    'i.business_id = $1',
    'i.deleted_at IS NULL',
    '(i.is_active IS NULL OR i.is_active = true)',
    'COALESCE(i.selling_price, 0) > 0',
    'COALESCE(i.has_variants, false) = false',
  ];
  if (settings.itemScope === 'store') where.push('i.show_in_store = true');
  if (opts.ids) {
    const ids = opts.ids.filter((id) => /^[0-9a-f-]{36}$/i.test(id));
    if (ids.length === 0) return [];
    params.push(ids);
    where.push(`i.id = ANY($${params.length}::uuid[])`);
  }
  params.push(SHOP_ITEMS_MAX);
  const rows = await queryRows<{
    id: string;
    name: string;
    description: string | null;
    selling_price: string;
    mrp: string | null;
    unit: string | null;
    category_name: string | null;
    item_type: string | null;
    current_stock: string | null;
    image_url: string | null;
  }>(
    `SELECT i.id, i.name, i.description, i.selling_price::text, i.mrp::text, i.unit,
            c.name AS category_name, i.item_type, i.current_stock::text, i.image_url
       FROM items i
       LEFT JOIN categories c ON c.id = i.category_id
      WHERE ${where.join(' AND ')}
      ORDER BY c.name NULLS LAST, i.name ASC
      LIMIT $${params.length}`,
    params,
  );
  return rows
    .map((r) => {
      const price = Number(r.selling_price) || 0;
      const mrp = r.mrp != null ? Number(r.mrp) : null;
      const tracked = (r.item_type || 'goods') === 'goods';
      return {
        id: r.id,
        name: r.name,
        description: r.description?.trim() || null,
        price,
        mrp: mrp != null && Number.isFinite(mrp) && mrp > price ? mrp : null,
        unit: r.unit,
        categoryName: r.category_name,
        inStock: !tracked || (Number(r.current_stock) || 0) > 0,
        imageSource: r.image_url?.trim() || null,
      };
    })
    .filter((item) => !settings.hideOutOfStock || item.inStock);
}

function imageSigningSecret(): string | null {
  const s = (process.env.UPI_PAY_LINK_SECRET || process.env.JWT_SECRET || '').trim();
  return s.length >= 16 ? s : null;
}

function signImage(itemId: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(`wa-shop-image:${itemId}`).digest('base64url').slice(0, 22);
}

export function verifyShopImageSignature(itemId: string, sig: string | null): boolean {
  const secret = imageSigningSecret();
  if (!secret || !sig || !/^[0-9a-f-]{36}$/i.test(itemId)) return false;
  const a = Buffer.from(sig);
  const b = Buffer.from(signImage(itemId, secret));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Public URL for an item's cover image. Item photos are usually stored inline as data URLs, which
 * Meta cannot fetch, so those are served through a signed route. Null when there is no image.
 */
export function shopImageUrl(item: Pick<ShopItem, 'id' | 'imageSource'>): string | null {
  const src = item.imageSource;
  if (!src) return null;
  if (/^https?:\/\//i.test(src)) return src;
  if (src.startsWith('/')) return `${appBaseUrl()}${src}`;
  if (!src.startsWith('data:image/')) return null;
  const secret = imageSigningSecret();
  if (!secret) return null;
  return `${appBaseUrl()}/api/public/wa-shop/image/${item.id}?s=${signImage(item.id, secret)}`;
}

export type ShopBusiness = {
  name: string;
  phone: string | null;
  storeBaseUrl: string | null;
};

export async function loadShopBusiness(businessId: string): Promise<ShopBusiness> {
  const row = await queryOne<{
    name: string | null;
    phone: string | null;
    store_subdomain: string | null;
    store_enabled: boolean | null;
  }>(
    `SELECT b.name, b.phone, bs.store_subdomain, bs.store_enabled
       FROM businesses b
       LEFT JOIN business_settings bs ON bs.business_id = b.id
      WHERE b.id = $1`,
    [businessId],
  );
  let storeBaseUrl: string | null = null;
  if (row?.store_enabled && row.store_subdomain) {
    const app = new URL(appBaseUrl());
    storeBaseUrl = `${app.protocol}//${storePublicHostname(row.store_subdomain, app.host)}`;
  }
  return { name: row?.name?.trim() || 'Our shop', phone: row?.phone ?? null, storeBaseUrl };
}

export const inr = (n: number): string => `₹${Number.isInteger(n) ? n : n.toFixed(2)}`;
