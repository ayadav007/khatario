import crypto from 'crypto';
import { query, queryRows } from '@/lib/db';
import { catalogItemsBatch, getMetaWaConfig, type CatalogBatchRequest } from '@/lib/meta-whatsapp';
import { appBaseUrl, inr, loadShopBusiness, loadShopItems, shopImageUrl, type ShopBusiness, type ShopItem } from './items';
import { getShopSettings, recordShopSync, type ShopSyncSummary } from './settings';

/** Meta accepts up to 5000 requests per batch but recommends far fewer. */
const BATCH_SIZE = 500;
const MAX_REPORTED_ERRORS = 20;

export class ShopSyncError extends Error {
  constructor(message: string, public code: string) {
    super(message);
    this.name = 'ShopSyncError';
  }
}

const money = (n: number) => `${n.toFixed(2)} INR`;

/** Fields Meta requires for a PRODUCT_ITEM; `id` is the Khatario item id (Meta's "content ID"). */
export function catalogProductData(item: ShopItem, business: ShopBusiness, imageLink: string): Record<string, unknown> & { id: string } {
  const details = [item.description, item.mrp ? `MRP ${inr(item.mrp)}` : null, item.unit ? `Per ${item.unit}` : null]
    .filter(Boolean)
    .join(' · ');
  return {
    id: item.id,
    title: item.name.slice(0, 200),
    description: (details || item.name).slice(0, 5000),
    availability: item.inStock ? 'in stock' : 'out of stock',
    condition: 'new',
    price: money(item.price),
    link: business.storeBaseUrl ? `${business.storeBaseUrl}/products/${item.id}` : appBaseUrl(),
    image_link: imageLink,
    brand: business.name.slice(0, 100),
  };
}

function hashOf(data: Record<string, unknown>): string {
  return crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');
}

/**
 * Brings the business's Meta catalog in line with its shop items: changed or new items are
 * upserted, items no longer sold are deleted, untouched items are skipped. Items without a photo
 * are skipped because Meta rejects products without an image.
 */
export async function syncShopCatalog(businessId: string, opts: { force?: boolean } = {}): Promise<ShopSyncSummary> {
  const settings = await getShopSettings(businessId);
  const catalogId = settings.metaCatalogId;
  if (!catalogId) throw new ShopSyncError('Add your Meta catalog ID first.', 'CATALOG_REQUIRED');
  if (!(await getMetaWaConfig(businessId))) {
    throw new ShopSyncError('Connect the WhatsApp Cloud API first.', 'CLOUD_API_REQUIRED');
  }

  const [items, business, synced] = await Promise.all([
    loadShopItems(businessId, settings),
    loadShopBusiness(businessId),
    queryRows<{ item_id: string; content_hash: string }>(
      `SELECT item_id, content_hash FROM whatsapp_catalog_items WHERE business_id = $1`,
      [businessId],
    ),
  ]);
  const previous = new Map(synced.map((r) => [r.item_id, r.content_hash]));
  const names = new Map(items.map((i) => [i.id, i.name]));

  const upserts: Array<{ request: CatalogBatchRequest; hash: string }> = [];
  let unchanged = 0;
  let skippedNoImage = 0;
  const live = new Set<string>();
  for (const item of items) {
    const image = shopImageUrl(item);
    if (!image) {
      skippedNoImage += 1;
      continue;
    }
    live.add(item.id);
    const data = catalogProductData(item, business, image);
    const hash = hashOf(data);
    if (!opts.force && previous.get(item.id) === hash) {
      unchanged += 1;
      continue;
    }
    upserts.push({ request: { method: 'UPDATE', data }, hash });
  }
  const deletes = synced.filter((r) => !live.has(r.item_id)).map((r) => r.item_id);

  const errors: ShopSyncSummary['errors'] = [];
  const failed = new Set<string>();
  const requests: CatalogBatchRequest[] = [
    ...upserts.map((u) => u.request),
    ...deletes.map((id): CatalogBatchRequest => ({ method: 'DELETE', data: { id } })),
  ];
  for (let i = 0; i < requests.length; i += BATCH_SIZE) {
    const chunk = requests.slice(i, i + BATCH_SIZE);
    const result = await catalogItemsBatch({ businessId, catalogId, requests: chunk });
    for (const e of result.errors) {
      failed.add(e.retailerId);
      if (errors.length < MAX_REPORTED_ERRORS) errors.push({ item: names.get(e.retailerId) || e.retailerId, message: e.message });
    }
  }

  const applied = upserts.filter((u) => !failed.has(u.request.data.id));
  for (const u of applied) {
    await query(
      `INSERT INTO whatsapp_catalog_items (business_id, item_id, catalog_id, content_hash, synced_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (business_id, item_id) DO UPDATE
         SET catalog_id = EXCLUDED.catalog_id, content_hash = EXCLUDED.content_hash, synced_at = NOW()`,
      [businessId, u.request.data.id, catalogId, u.hash],
    );
  }
  const removed = deletes.filter((id) => !failed.has(id));
  if (removed.length) {
    await query(`DELETE FROM whatsapp_catalog_items WHERE business_id = $1 AND item_id = ANY($2::uuid[])`, [
      businessId,
      removed,
    ]);
  }

  const summary: ShopSyncSummary = {
    at: new Date().toISOString(),
    pushed: applied.length,
    removed: removed.length,
    unchanged,
    skippedNoImage,
    errors,
  };
  await recordShopSync(businessId, summary);
  return summary;
}
