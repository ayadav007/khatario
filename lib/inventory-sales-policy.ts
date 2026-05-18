/**
 * Resolves whether a goods line may be invoiced when available stock < quantity.
 * Item NULL inherits business_settings.default_allow_sale_when_out_of_stock.
 */

import { queryOne } from '@/lib/db';

export async function getEffectiveAllowSaleWhenOutOfStock(
  businessId: string,
  itemId: string
): Promise<boolean> {
  const row = await queryOne<{
    allow: boolean | null;
    default_allow: boolean | null;
  }>(
    `SELECT i.allow_sale_when_out_of_stock AS allow,
            bs.default_allow_sale_when_out_of_stock AS default_allow
     FROM items i
     LEFT JOIN business_settings bs ON bs.business_id = i.business_id
     WHERE i.id = $1 AND i.business_id = $2`,
    [itemId, businessId]
  );
  if (!row) return false;
  if (row.allow !== null && row.allow !== undefined) {
    return !!row.allow;
  }
  return !!row.default_allow;
}
