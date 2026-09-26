import { queryOne } from '@/lib/db';
import type { Item } from '@/types/database';
import {
  canEnableStoreFeatured,
  countStoreFeaturedItems,
  featuredLimitMessage,
} from '@/lib/store/store-featured';

export async function applyItemStoreListingFlags(input: {
  item: Item;
  show_in_store?: boolean;
  featured_in_store?: boolean;
}): Promise<
  | { ok: true; item: Item }
  | { ok: false; status: number; error: string; code: string }
> {
  let showInStore = input.show_in_store ?? !!input.item.show_in_store;
  let featured = input.featured_in_store ?? !!input.item.featured_in_store;

  if (featured) showInStore = true;
  if (!showInStore) featured = false;

  if (featured && !input.item.featured_in_store) {
    const count = await countStoreFeaturedItems(input.item.business_id);
    if (
      !canEnableStoreFeatured({
        alreadyFeatured: false,
        currentFeaturedCount: count,
      })
    ) {
      return {
        ok: false,
        status: 409,
        error: featuredLimitMessage(),
        code: 'FEATURED_LIMIT',
      };
    }
  }

  const row = await queryOne<Item>(
    `UPDATE items
     SET show_in_store = $3,
         featured_in_store = $4,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL
     RETURNING *`,
    [input.item.id, input.item.business_id, showInStore, featured],
  );
  if (!row) {
    return { ok: false, status: 404, error: 'Item not found', code: 'NOT_FOUND' };
  }
  return { ok: true, item: row };
}
