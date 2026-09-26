import { queryOne } from '@/lib/db';

export const MAX_STORE_FEATURED_ITEMS = 6;

export function canEnableStoreFeatured(input: {
  alreadyFeatured: boolean;
  currentFeaturedCount: number;
  max?: number;
}): boolean {
  if (input.alreadyFeatured) return true;
  return input.currentFeaturedCount < (input.max ?? MAX_STORE_FEATURED_ITEMS);
}

export function featuredLimitMessage(max = MAX_STORE_FEATURED_ITEMS): string {
  return `${max} items are already featured. Turn one off before featuring another.`;
}

export async function countStoreFeaturedItems(businessId: string): Promise<number> {
  const row = await queryOne<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM items
     WHERE business_id = $1
       AND featured_in_store = true
       AND deleted_at IS NULL`,
    [businessId],
  );
  return Number(row?.count ?? 0);
}
