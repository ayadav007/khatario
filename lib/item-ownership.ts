/**
 * Enforce inventory invariant: stock and movements must reference items owned by the same business.
 */

import type { PoolClient } from 'pg';

export class ItemOwnershipError extends Error {
  constructor(
    message: string,
    public readonly code = 'ITEM_BUSINESS_MISMATCH'
  ) {
    super(message);
    this.name = 'ItemOwnershipError';
  }
}

/**
 * Throws ItemOwnershipError if the item is missing or belongs to another business.
 */
export async function assertItemBelongsToBusiness(
  client: Pick<PoolClient, 'query'>,
  itemId: string,
  businessId: string
): Promise<void> {
  const r = await client.query(
    `SELECT 1 FROM items WHERE id = $1 AND business_id = $2`,
    [itemId, businessId]
  );
  if (r.rows.length === 0) {
    throw new ItemOwnershipError(
      `Item does not exist or is not part of this business (item_id=${itemId}).`
    );
  }
}

/**
 * Validate multiple item ids (skips null/undefined).
 */
export async function assertAllItemsBelongToBusiness(
  client: Pick<PoolClient, 'query'>,
  businessId: string,
  itemIds: Array<string | null | undefined>
): Promise<void> {
  const unique = [...new Set(itemIds.filter((id): id is string => !!id && String(id).trim() !== ''))];
  for (const id of unique) {
    await assertItemBelongsToBusiness(client, id, businessId);
  }
}
